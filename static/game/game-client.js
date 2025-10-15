import { AssetCache } from './asset-cache.js';
import { MobileControls } from './mobile-controls.js';
import { Renderer } from './renderer.js';
import { UIManager } from './ui-manager.js';
import { LocalSimulator, PLAYER_RADIUS, resolvePlayerMovement } from './local-simulator.js';

export class GameClient {
  constructor(container, socket, onDispose = () => {}) {
    this.container = container;
    this.socket = socket;
    this.onDispose = typeof onDispose === 'function' ? onDispose : () => {};

    this.canvas = document.createElement('canvas');
    this.canvas.width = 800;
    this.canvas.height = 600;
    this.canvas.tabIndex = 0;
    this.canvas.style.imageRendering = 'pixelated';
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
    this.localSimulator = null;
    this.isHost = false;
    this.keyState = {};
    this.spaceDown = false;
    this.lastFrame = performance.now();
    this.lastMoveSent = 0;
    this.lastSentPosition = null;
    this.frameHandle = null;
    this.pendingUiState = null;
    this.uiSyncInterval = 1 / 15;
    this.uiSyncAccumulator = 0;
    this.stateBroadcastInterval = 0.1;
    this.stateBroadcastTimer = 0;

    this.boundKeyDown = (event) => this.handleKeyDown(event);
    this.boundKeyUp = (event) => this.handleKeyUp(event);
    this.boundVisibilityChange = () => this.handleVisibilityChange();
    this.boundStateUpdate = (state) => this.handleStateUpdate(state);
    this.boundForceDisconnect = () => this.handleForceDisconnect();
    this.boundClientInteract = (payload) => this.handleClientInteract(payload);
    this.boundClientMove = (payload) => this.handleClientMove(payload);

    this.mobileControls = new MobileControls(this);
  }

  start() {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);

    this.socket.off('state_update', this.boundStateUpdate);
    this.socket.off('force_disconnect', this.boundForceDisconnect);
    this.socket.off('client_interact', this.boundClientInteract);
    this.socket.off('client_move', this.boundClientMove);
    this.socket.on('state_update', this.boundStateUpdate);
    this.socket.on('force_disconnect', this.boundForceDisconnect);
    this.socket.on('client_interact', this.boundClientInteract);
    this.socket.on('client_move', this.boundClientMove);

    const payload = { room: String(window.roomName || 'room1') };
    this.socket.emit('join', payload, (data) => {
      window.playerId = data.playerId;
      this.isHost = Boolean(data?.isHost);
      if (this.isHost && !this.localSimulator) {
        this.localSimulator = new LocalSimulator();
      } else if (!this.isHost) {
        this.localSimulator = null;
      }
      this.stateBroadcastTimer = 0;
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
    this.socket.off('client_interact', this.boundClientInteract);
    this.socket.off('client_move', this.boundClientMove);
    this.pendingUiState = null;
    this.uiSyncAccumulator = 0;
    this.serverState = null;
    this.localPosition = null;
    this.lastSentPosition = null;
    this.localSimulator = null;
    this.isHost = false;
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
    const cloned = this.cloneState(state);
    this.serverState = cloned;
    const isClientManaged = Boolean(state?.clientManaged);
    if (state.players && window.playerId && state.players[window.playerId]) {
      const me = state.players[window.playerId];
      if (!this.localPosition) {
        this.localPosition = { x: me.x, y: me.y };
      } else if (!this.isHost) {
        if (!isClientManaged) {
          const dx = this.localPosition.x - me.x;
          const dy = this.localPosition.y - me.y;
          if (dx * dx + dy * dy > 36) {
            this.localPosition.x = me.x;
            this.localPosition.y = me.y;
          }
        }
      }
      if (!this.lastSentPosition && this.localPosition) {
        this.lastSentPosition = { x: this.localPosition.x, y: this.localPosition.y };
      }
    }

    if (this.isHost) {
      if (!this.localSimulator) {
        this.localSimulator = new LocalSimulator();
      }
      if (!this.localSimulator.hasState()) {
        this.localSimulator.loadState(cloned);
      } else {
        this.localSimulator.mergeServerState(cloned, window.playerId);
      }
      this.queueUiFromLocal();
    } else {
      this.setPendingUiState(cloned);
    }
  }

  handleForceDisconnect() {
    alert('サーバーから切断されました。再度接続してください。');
    this.destroy();
    document.getElementById('start-overlay').style.display = 'block';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('ui').style.display = 'none';
  }

  handleKeyDown(event) {
    if (event.code === 'Space') {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.emitInteract();
      }
      event.preventDefault();
      return;
    }

    if (this.isMovementKey(event.code)) {
      if (!event.repeat) {
        this.setKeyState(event.code, true);
      }
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
    const payload = {
      room: window.roomName,
      playerId: window.playerId,
    };

    const local = this.localPosition;
    if (local && Number.isFinite(local.x) && Number.isFinite(local.y)) {
      payload.x = local.x;
      payload.y = local.y;
    } else if (this.serverState?.players?.[window.playerId]) {
      const serverPlayer = this.serverState.players[window.playerId];
      if (Number.isFinite(serverPlayer.x) && Number.isFinite(serverPlayer.y)) {
        payload.x = serverPlayer.x;
        payload.y = serverPlayer.y;
      }
    }

    if (this.isHost && this.localSimulator) {
      const x = Number.isFinite(payload.x) ? payload.x : this.localPosition?.x;
      const y = Number.isFinite(payload.y) ? payload.y : this.localPosition?.y;
      const handled = this.localSimulator.handleInteract(window.playerId, {
        x,
        y,
      });
      if (handled) {
        this.queueUiFromLocal();
        this.broadcastLocalState(true);
      }
      return;
    }

    this.socket.emit('interact', payload);
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
    const speed = 220;
    let targetX = this.localPosition.x;
    let targetY = this.localPosition.y;
    if (movement.moving) {
      const len = Math.hypot(movement.vx, movement.vy) || 1;
      targetX += (movement.vx / len) * speed * dt;
      targetY += (movement.vy / len) * speed * dt;
    }

    if (this.isHost && this.localSimulator) {
      this.localSimulator.handleMove(window.playerId, targetX, targetY);
      const simPlayer = this.localSimulator.getPlayer(window.playerId);
      if (simPlayer) {
        this.localPosition.x = simPlayer.x;
        this.localPosition.y = simPlayer.y;
      } else {
        this.localPosition.x = targetX;
        this.localPosition.y = targetY;
      }
    } else if (this.serverState?.players?.[window.playerId]) {
      const playerState = this.serverState.players[window.playerId];
      playerState.x = this.localPosition.x;
      playerState.y = this.localPosition.y;
      if (playerState.currentItem) {
        playerState.currentItem.x = this.localPosition.x;
        playerState.currentItem.y = this.localPosition.y;
      }
      resolvePlayerMovement(this.serverState, playerState, targetX, targetY);
      this.localPosition.x = playerState.x;
      this.localPosition.y = playerState.y;
    } else {
      this.localPosition.x = targetX;
      this.localPosition.y = targetY;
    }

    if (this.serverState?.players?.[window.playerId]) {
      const playerState = this.serverState.players[window.playerId];
      playerState.x = this.localPosition.x;
      playerState.y = this.localPosition.y;
      if (playerState.currentItem) {
        playerState.currentItem.x = this.localPosition.x;
        playerState.currentItem.y = this.localPosition.y;
      }
    }

    this.clampLocalPosition();
    this.maybeSendMove(movement.moving);

    if (this.isHost && this.localSimulator) {
      this.localSimulator.update(dt);
      this.queueUiFromLocal();
      this.stateBroadcastTimer += dt;
      if (this.localSimulator.hasDirtyState() && this.stateBroadcastTimer >= this.stateBroadcastInterval) {
        this.broadcastLocalState(false);
      }
    }
  }

  render() {
    if (!this.serverState && !(this.isHost && this.localSimulator)) {
      return;
    }

    let sourceState = this.serverState;
    if (this.isHost && this.localSimulator) {
      const local = this.localSimulator.getDisplayState();
      if (local) {
        sourceState = local;
      }
    }
    if (!sourceState) {
      return;
    }

    const displayState = this.cloneState(sourceState);
    if (window.playerId && this.localPosition && displayState.players?.[window.playerId]) {
      displayState.players[window.playerId].x = this.localPosition.x;
      displayState.players[window.playerId].y = this.localPosition.y;
    }

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

  setPendingUiState(state) {
    if (!state) return;
    this.pendingUiState = this.cloneState(state);
    this.uiSyncAccumulator = this.uiSyncInterval;
  }

  queueUiFromLocal() {
    if (!this.localSimulator) return;
    const state = this.localSimulator.getDisplayState();
    if (!state) return;
    this.setPendingUiState(state);
  }

  broadcastLocalState(force) {
    if (!this.isHost || !this.localSimulator || !window.roomName || !window.playerId) {
      return;
    }
    if (!force && !this.localSimulator.hasDirtyState()) {
      return;
    }
    const state = this.localSimulator.getDisplayState();
    if (!state) {
      return;
    }
    this.socket.emit('client_state', {
      room: window.roomName,
      playerId: window.playerId,
      state,
    });
    this.localSimulator.clearDirtyState();
    this.stateBroadcastTimer = 0;
    this.setPendingUiState(state);
  }

  handleClientMove(payload) {
    if (!this.isHost || !this.localSimulator) {
      return;
    }
    const { playerId, x, y } = payload || {};
    if (!playerId || playerId === window.playerId) {
      return;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    this.localSimulator.handleMove(playerId, x, y);
    this.queueUiFromLocal();
  }

  handleClientInteract(payload) {
    if (!this.isHost || !this.localSimulator) {
      return;
    }
    const { playerId } = payload || {};
    if (!playerId || playerId === window.playerId) {
      return;
    }
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    const handled = this.localSimulator.handleInteract(playerId, { x, y });
    if (handled) {
      this.queueUiFromLocal();
      this.broadcastLocalState(true);
    }
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
    const minX = PLAYER_RADIUS;
    const maxX = this.canvas.width - PLAYER_RADIUS;
    const minY = PLAYER_RADIUS;
    const maxY = this.canvas.height - PLAYER_RADIUS;
    this.localPosition.x = Math.max(minX, Math.min(maxX, this.localPosition.x));
    this.localPosition.y = Math.max(minY, Math.min(maxY, this.localPosition.y));
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
}
