import { AssetCache } from './asset-cache.js';
import { MobileControls } from './mobile-controls.js';
import { Renderer } from './renderer.js';
import { UIManager } from './ui-manager.js';

export class GameClient {
  constructor(container, socket, onDispose = () => {}) {
    this.container = container;
    this.socket = socket;
    this.onDispose = typeof onDispose === 'function' ? onDispose : () => {};

    this.canvas = document.createElement('canvas');
    this.canvas.width = 800;
    this.canvas.height = 600;
    this.canvas.tabIndex = 0;
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);

    this.assets = new AssetCache();
    this.renderer = new Renderer(this.canvas, this.assets);
    this.ui = new UIManager({
      timerEl: document.getElementById('timer'),
      scoreEl: document.getElementById('score'),
      inventoryEl: document.getElementById('inventory'),
      orderListEl: document.getElementById('order-list'),
      gameOverMessageEl: document.getElementById('game-over-message'),
    });

    this.serverState = null;
    this.localPosition = null;
    this.authoritativePosition = null;
    this.keyState = {};
    this.spaceDown = false;
    this.lastFrame = performance.now();
    this.lastMoveSent = 0;
    this.lastSentPosition = null;
    this.frameHandle = null;
    this.pendingUiState = null;
    this.uiSyncInterval = 1 / 15;
    this.uiSyncAccumulator = 0;
    this.stateBuffer = [];
    this.maxSnapshots = 90;
    this.serverTimeOffset = null;
    this.interpolationDelay = 0.12;
    this.offsetLerp = 0.1;
    this.reconciliationRate = 12;

    this.boundKeyDown = (event) => this.handleKeyDown(event);
    this.boundKeyUp = (event) => this.handleKeyUp(event);
    this.boundVisibilityChange = () => this.handleVisibilityChange();
    this.boundStateUpdate = (state) => this.handleStateUpdate(state);
    this.boundForceDisconnect = () => this.handleForceDisconnect();

    this.mobileControls = new MobileControls(this);
  }

  start() {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);

    this.socket.off('state_update', this.boundStateUpdate);
    this.socket.off('force_disconnect', this.boundForceDisconnect);
    this.socket.on('state_update', this.boundStateUpdate);
    this.socket.on('force_disconnect', this.boundForceDisconnect);

    const payload = { room: String(window.roomName || 'room1') };
    this.socket.emit('join', payload, (data) => {
      window.playerId = data.playerId;
    });

    this.canvas.focus({ preventScroll: true });
    this.frameHandle = requestAnimationFrame((ts) => this.loop(ts));
  }

  destroy() {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    this.socket.off('state_update', this.boundStateUpdate);
    this.socket.off('force_disconnect', this.boundForceDisconnect);
    this.pendingUiState = null;
    this.uiSyncAccumulator = 0;
    this.stateBuffer = [];
    this.serverTimeOffset = null;
    this.authoritativePosition = null;
    this.localPosition = null;
    this.lastSentPosition = null;
    if (this.mobileControls) {
      this.mobileControls.destroy();
      this.mobileControls = null;
    }
    const dispose = this.onDispose;
    this.onDispose = () => {};
    dispose();
  }

  loop(timestamp) {
    const dt = Math.min((timestamp - this.lastFrame) / 1000, 0.1);
    this.lastFrame = timestamp;
    this.update(dt);
    this.render();
    this.frameHandle = requestAnimationFrame((ts) => this.loop(ts));
  }

  handleStateUpdate(state) {
    const receiveTime = performance.now() / 1000;
    const serverTime =
      typeof state.serverTime === 'number' ? state.serverTime : receiveTime;
    const offsetEstimate = serverTime - receiveTime;
    if (this.serverTimeOffset == null) {
      this.serverTimeOffset = offsetEstimate;
    } else {
      this.serverTimeOffset =
        this.serverTimeOffset * (1 - this.offsetLerp) + offsetEstimate * this.offsetLerp;
    }

    this.serverState = state;
    if (state.players && window.playerId && state.players[window.playerId]) {
      const me = state.players[window.playerId];
      if (!this.localPosition) {
        this.localPosition = { x: me.x, y: me.y };
      }
      if (!this.authoritativePosition) {
        this.authoritativePosition = { x: me.x, y: me.y };
      } else {
        this.authoritativePosition.x = me.x;
        this.authoritativePosition.y = me.y;
      }
      if (!this.lastSentPosition && this.localPosition) {
        this.lastSentPosition = { x: this.localPosition.x, y: this.localPosition.y };
      }
    }

    this.pushSnapshot(state, serverTime);

    this.pendingUiState = state;
    this.uiSyncAccumulator = this.uiSyncInterval;
  }

  handleForceDisconnect() {
    alert('サーバーから切断されました。再度接続してください。');
    this.destroy();
    document.getElementById('start-overlay').style.display = 'block';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('ui').style.display = 'none';
  }

  handleKeyDown(event) {
    if (event.repeat) return;
    if (event.code === 'Space') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.emitInteract();
      }
      event.preventDefault();
      return;
    }

    if (this.isMovementKey(event.code)) {
      this.setKeyState(event.code, true);
      event.preventDefault();
    }
  }

  handleKeyUp(event) {
    if (event.code === 'Space') {
      this.spaceDown = false;
      event.preventDefault();
      return;
    }
    if (this.isMovementKey(event.code)) {
      this.setKeyState(event.code, false);
      event.preventDefault();
    }
  }

  handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.keyState = {};
    }
  }

  isMovementKey(code) {
    return (
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD'
    );
  }

  setKeyState(code, pressed) {
    if (!code) return;
    if (pressed) {
      this.keyState[code] = true;
    } else {
      this.keyState[code] = false;
    }
  }

  emitInteract() {
    if (!window.roomName || !window.playerId) return;
    this.socket.emit('interact', { room: window.roomName, playerId: window.playerId });
  }

  update(dt) {
    this.flushPendingUi(dt);

    if (!this.serverState || !window.playerId) return;
    const me = this.serverState.players?.[window.playerId];
    if (!me) return;

    if (!this.localPosition) {
      this.localPosition = { x: me.x, y: me.y };
    }

    const movement = this.computeMovementVector();
    if (movement.moving) {
      const speed = 220;
      const len = Math.hypot(movement.vx, movement.vy) || 1;
      this.localPosition.x += (movement.vx / len) * speed * dt;
      this.localPosition.y += (movement.vy / len) * speed * dt;
    }

    this.clampLocalPosition();
    this.applyReconciliation(dt);
    this.maybeSendMove(movement.moving);
  }

  render() {
    const displayState = this.getInterpolatedState();
    this.renderer.render(displayState, window.playerId);
  }

  flushPendingUi(dt) {
    if (!this.pendingUiState) {
      this.uiSyncAccumulator = 0;
      return;
    }

    this.uiSyncAccumulator += dt;
    if (this.uiSyncAccumulator < this.uiSyncInterval) {
      return;
    }

    this.ui.update(this.pendingUiState, window.playerId);
    this.pendingUiState = null;
    this.uiSyncAccumulator = 0;
  }

  computeMovementVector() {
    const left = this.keyState['ArrowLeft'] || this.keyState['KeyA'];
    const right = this.keyState['ArrowRight'] || this.keyState['KeyD'];
    const up = this.keyState['ArrowUp'] || this.keyState['KeyW'];
    const down = this.keyState['ArrowDown'] || this.keyState['KeyS'];

    let vx = 0;
    let vy = 0;
    if (left && !right) vx = -1;
    if (right && !left) vx = 1;
    if (up && !down) vy = -1;
    if (down && !up) vy = 1;

    return { vx, vy, moving: vx !== 0 || vy !== 0 };
  }

  clampLocalPosition() {
    if (!this.localPosition) return;
    this.localPosition.x = Math.max(0, Math.min(this.canvas.width, this.localPosition.x));
    this.localPosition.y = Math.max(0, Math.min(this.canvas.height, this.localPosition.y));
  }

  applyReconciliation(dt) {
    if (!this.authoritativePosition || !this.localPosition) return;
    const dx = this.authoritativePosition.x - this.localPosition.x;
    const dy = this.authoritativePosition.y - this.localPosition.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < 0.25) {
      return;
    }
    const factor = Math.min(1, dt * this.reconciliationRate);
    this.localPosition.x += dx * factor;
    this.localPosition.y += dy * factor;
  }

  maybeSendMove(moving) {
    if (!this.localPosition || !window.roomName || !window.playerId) return;
    const now = performance.now();
    const targetInterval = moving ? 50 : 150;
    const shouldSendByTime = now - this.lastMoveSent > targetInterval;
    let shouldSendByDistance = false;
    if (this.lastSentPosition) {
      const dx = this.localPosition.x - this.lastSentPosition.x;
      const dy = this.localPosition.y - this.lastSentPosition.y;
      shouldSendByDistance = dx * dx + dy * dy > 4;
    } else {
      shouldSendByDistance = true;
    }

    if (!shouldSendByTime && !shouldSendByDistance) {
      return;
    }

    this.lastMoveSent = now;
    this.lastSentPosition = { x: this.localPosition.x, y: this.localPosition.y };
    this.socket.emit('move', {
      room: window.roomName,
      playerId: window.playerId,
      x: this.localPosition.x,
      y: this.localPosition.y,
    });
  }

  pushSnapshot(state, serverTime) {
    const snapshotState = this.cloneState(state);
    snapshotState.serverTime = serverTime;
    this.stateBuffer.push({ time: serverTime, state: snapshotState });
    if (this.stateBuffer.length > this.maxSnapshots) {
      this.stateBuffer.splice(0, this.stateBuffer.length - this.maxSnapshots);
    }

    const cutoff = serverTime - 2;
    while (this.stateBuffer.length > 2 && this.stateBuffer[0].time < cutoff) {
      this.stateBuffer.shift();
    }
  }

  cloneState(state) {
    const clonedPlayers = this.clonePlayers(state.players || {});
    const clonedItems = this.cloneItems(state.items || []);
    return {
      ...state,
      players: clonedPlayers,
      items: clonedItems,
    };
  }

  clonePlayers(players) {
    const result = {};
    Object.entries(players).forEach(([pid, player]) => {
      result[pid] = this.clonePlayer(player);
    });
    return result;
  }

  clonePlayer(player) {
    if (!player) return null;
    const clone = { ...player };
    if (player.currentItem) {
      clone.currentItem = { ...player.currentItem };
    }
    return clone;
  }

  cloneItems(items) {
    return items.map((item) => ({ ...item }));
  }

  getRenderTime() {
    const now = performance.now() / 1000;
    const offset = this.serverTimeOffset ?? 0;
    return now + offset - this.interpolationDelay;
  }

  interpolatePlayers(targetTime) {
    if (!this.stateBuffer.length) {
      return null;
    }

    let previous = this.stateBuffer[0];
    let next = this.stateBuffer[this.stateBuffer.length - 1];

    for (let i = 0; i < this.stateBuffer.length; i += 1) {
      const snapshot = this.stateBuffer[i];
      if (snapshot.time <= targetTime) {
        previous = snapshot;
      }
      if (snapshot.time >= targetTime) {
        next = snapshot;
        break;
      }
    }

    if (!previous || !next) {
      return null;
    }

    if (previous === next || next.time === previous.time) {
      return this.clonePlayers(previous.state.players || {});
    }

    const alpha = Math.max(
      0,
      Math.min(1, (targetTime - previous.time) / (next.time - previous.time))
    );
    const players = {};
    const ids = new Set([
      ...Object.keys(previous.state.players || {}),
      ...Object.keys(next.state.players || {}),
    ]);

    ids.forEach((pid) => {
      const prevPlayer = previous.state.players?.[pid];
      const nextPlayer = next.state.players?.[pid];
      if (prevPlayer && nextPlayer) {
        const lerped = this.clonePlayer(nextPlayer);
        lerped.x = prevPlayer.x + (nextPlayer.x - prevPlayer.x) * alpha;
        lerped.y = prevPlayer.y + (nextPlayer.y - prevPlayer.y) * alpha;
        players[pid] = lerped;
      } else if (nextPlayer) {
        players[pid] = this.clonePlayer(nextPlayer);
      } else if (prevPlayer) {
        players[pid] = this.clonePlayer(prevPlayer);
      }
    });

    return players;
  }

  getInterpolatedState() {
    if (!this.serverState) {
      return null;
    }

    const interpolatedPlayers = this.interpolatePlayers(this.getRenderTime());
    const state = this.cloneState(this.serverState);
    if (interpolatedPlayers) {
      state.players = interpolatedPlayers;
    }

    if (window.playerId && this.localPosition && state.players?.[window.playerId]) {
      state.players[window.playerId].x = this.localPosition.x;
      state.players[window.playerId].y = this.localPosition.y;
    }

    return state;
  }
}
