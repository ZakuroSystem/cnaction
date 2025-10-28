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
    this.moveSequence = 0;
    this.lastAckedMove = 0;
    this.remoteMoveSequences = new Map();
    this.lastServerTime = 0;
    this.pendingMoves = [];
    this.actionSequence = 0;
    this.lastAckedAction = 0;
    this.pendingActions = [];
    this.predictionSimulator = null;

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
    this.moveSequence = 0;
    this.lastAckedMove = 0;
    this.lastServerTime = 0;
    this.localPosition = null;
    this.lastSentPosition = null;
    this.clearPendingMoves();
    this.actionSequence = 0;
    this.lastAckedAction = 0;
    this.clearPendingActions();
    this.releasePredictionSimulator();
    if (this.remoteMoveSequences) {
      this.remoteMoveSequences.clear();
    }
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
    this.moveSequence = 0;
    this.lastAckedMove = 0;
    this.lastServerTime = 0;
    this.clearPendingMoves();
    this.actionSequence = 0;
    this.lastAckedAction = 0;
    this.clearPendingActions();
    this.releasePredictionSimulator();
    if (this.remoteMoveSequences) {
      this.remoteMoveSequences.clear();
    }
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
    const serverTime = Number(state?.serverTime);
    const hasServerTime = Number.isFinite(serverTime);
    const previousServerTime = Number(this.lastServerTime) || 0;
    if (hasServerTime && previousServerTime && serverTime < previousServerTime) {
      return;
    }
    const me = state?.players?.[window.playerId];
    const ackSeq = Number(me?.lastMoveSeq);
    if (Number.isFinite(ackSeq)) {
      if (ackSeq < this.lastAckedMove) {
        if (!(hasServerTime && serverTime > previousServerTime)) {
          return;
        }
        this.clearPendingMoves();
      }
      this.lastAckedMove = ackSeq;
    } else if (hasServerTime && serverTime > previousServerTime) {
      this.clearPendingMoves();
    }
    const ackAction = Number(me?.lastActionSeq);
    if (Number.isFinite(ackAction)) {
      if (ackAction < this.lastAckedAction) {
        if (!(hasServerTime && serverTime > previousServerTime)) {
          return;
        }
        this.clearPendingActions();
        this.releasePredictionSimulator();
      }
      this.lastAckedAction = ackAction;
    } else if (hasServerTime && serverTime > previousServerTime) {
      this.clearPendingActions();
      this.releasePredictionSimulator();
    }
    if (Array.isArray(this.pendingActions) && this.pendingActions.length) {
      this.pendingActions = this.pendingActions.filter((action) => {
        if (!action || !Number.isFinite(Number(action.seq))) {
          return false;
        }
        return Number(action.seq) > this.lastAckedAction;
      });
    }
    if (hasServerTime && serverTime >= previousServerTime) {
      this.lastServerTime = serverTime;
    }
    const cloned = this.cloneState(state);
    this.serverState = cloned;
    this.applyPendingActionPredictions();
    this.reconcileLocalPrediction(this.serverState, Number.isFinite(ackSeq) ? ackSeq : null);
    const isClientManaged = Boolean(this.serverState?.clientManaged);
    if (state.players && window.playerId && state.players[window.playerId]) {
      const serverPlayer = state.players[window.playerId];
      const serverX = Number(serverPlayer?.x);
      const serverY = Number(serverPlayer?.y);
      if (!this.localPosition) {
        const predicted = this.serverState?.players?.[window.playerId];
        const baseX = Number.isFinite(predicted?.x) ? predicted.x : serverX;
        const baseY = Number.isFinite(predicted?.y) ? predicted.y : serverY;
        if (Number.isFinite(baseX) && Number.isFinite(baseY)) {
          this.localPosition = { x: baseX, y: baseY };
        }
      } else if (!this.isHost && Number.isFinite(serverX) && Number.isFinite(serverY)) {
        const dx = this.localPosition.x - serverX;
        const dy = this.localPosition.y - serverY;
        if (dx * dx + dy * dy > 36) {
          this.applyReconciledPosition(serverX, serverY);
          this.lastSentPosition = { x: serverX, y: serverY };
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
        this.localSimulator.loadState(this.serverState);
      } else {
        this.localSimulator.mergeServerState(this.serverState, window.playerId);
      }
      this.queueUiFromLocal();
    } else {
      this.setPendingUiState(this.serverState);
    }

    if (this.remoteMoveSequences && this.remoteMoveSequences.size) {
      const activePlayers = new Set(Object.keys(this.serverState?.players || {}));
      for (const key of Array.from(this.remoteMoveSequences.keys())) {
        if (!activePlayers.has(key)) {
          this.remoteMoveSequences.delete(key);
        }
      }
    }
    if (this.remoteMoveSequences) {
      Object.entries(this.serverState?.players || {}).forEach(([pid, player]) => {
        if (pid === window.playerId) {
          return;
        }
        const seq = Number(player?.lastMoveSeq);
        if (Number.isFinite(seq) && seq >= 0) {
          this.remoteMoveSequences.set(pid, seq);
        }
      });
    }
  }

  clearPendingMoves() {
    if (Array.isArray(this.pendingMoves)) {
      this.pendingMoves.length = 0;
    } else {
      this.pendingMoves = [];
    }
  }

  clearPendingActions() {
    if (Array.isArray(this.pendingActions)) {
      this.pendingActions.length = 0;
    } else {
      this.pendingActions = [];
    }
  }

  releasePredictionSimulator() {
    this.predictionSimulator = null;
  }

  ensurePredictionSimulator() {
    if (!this.predictionSimulator) {
      this.predictionSimulator = new LocalSimulator();
    }
    return this.predictionSimulator;
  }

  applyPendingActionPredictions() {
    if (
      this.isHost ||
      !this.serverState ||
      !window.playerId ||
      !Array.isArray(this.pendingActions) ||
      this.pendingActions.length === 0
    ) {
      return;
    }
    const actionable = this.pendingActions.filter((action) => action?.predicted);
    if (!actionable.length) {
      return;
    }
    const simulator = this.ensurePredictionSimulator();
    simulator.loadState(this.serverState);
    let changed = false;
    actionable.forEach((action) => {
      if (!action) {
        return;
      }
      const handled = simulator.handleInteract(window.playerId, {
        x: action.x,
        y: action.y,
      });
      if (handled) {
        changed = true;
      }
      const seqNum = Number(action.seq);
      if (Number.isFinite(seqNum)) {
        const simPlayer = simulator.getPlayer(window.playerId);
        if (simPlayer && (!Number.isFinite(simPlayer.lastActionSeq) || seqNum > simPlayer.lastActionSeq)) {
          simPlayer.lastActionSeq = seqNum;
          changed = true;
        }
      }
    });
    if (!changed) {
      return;
    }
    const predicted = simulator.getDisplayState();
    if (!predicted) {
      return;
    }
    this.serverState = predicted;
    const me = predicted.players?.[window.playerId];
    if (me && Number.isFinite(me.x) && Number.isFinite(me.y)) {
      this.applyReconciledPosition(me.x, me.y);
      this.lastSentPosition = { x: me.x, y: me.y };
    }
  }

  reconcileLocalPrediction(state, ackSeq) {
    if (this.isHost || !state || !window.playerId) {
      return;
    }
    const players = state.players || {};
    const me = players[window.playerId];
    if (!me) {
      return;
    }
    if (!Array.isArray(this.pendingMoves)) {
      this.pendingMoves = [];
    }
    if (!this.localPosition) {
      if (Number.isFinite(me.x) && Number.isFinite(me.y)) {
        this.localPosition = { x: me.x, y: me.y };
        this.lastSentPosition = { x: me.x, y: me.y };
      }
      return;
    }

    if (Number.isFinite(ackSeq)) {
      this.pendingMoves = this.pendingMoves.filter((move) => move && move.seq > ackSeq);
    }

    let targetX = Number(me.x);
    let targetY = Number(me.y);
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      return;
    }

    if (this.pendingMoves.length) {
      const simPlayer = this.clonePlayer(me) || { x: targetX, y: targetY };
      const simState = { config: state.config || null };
      for (const move of this.pendingMoves) {
        if (!move) continue;
        const mx = Number(move.x);
        const my = Number(move.y);
        if (!Number.isFinite(mx) || !Number.isFinite(my)) continue;
        resolvePlayerMovement(simState, simPlayer, mx, my);
      }
      targetX = simPlayer.x;
      targetY = simPlayer.y;
    } else if (Number.isFinite(ackSeq)) {
      this.lastSentPosition = { x: targetX, y: targetY };
    }

    this.applyReconciledPosition(targetX, targetY);
  }

  applyReconciledPosition(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    if (!this.localPosition) {
      this.localPosition = { x, y };
    } else {
      this.localPosition.x = x;
      this.localPosition.y = y;
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

    this.actionSequence += 1;
    const seq = this.actionSequence;
    payload.actionSeq = seq;

    const actionRecord = {
      seq,
      x: payload.x,
      y: payload.y,
      timestamp: performance.now(),
      predicted: false,
    };

    const predicted = this.applyLocalInteractionPrediction(actionRecord);
    actionRecord.predicted = predicted;
    this.recordPendingAction(actionRecord);

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
    const seq = Number(payload?.seq);
    if (Number.isFinite(seq)) {
      const lastSeq = this.remoteMoveSequences?.get(playerId) || 0;
      if (seq <= lastSeq) {
        return;
      }
      if (this.remoteMoveSequences) {
        this.remoteMoveSequences.set(playerId, seq);
      }
      const simPlayer = this.localSimulator.ensurePlayer(playerId);
      if (simPlayer) {
        simPlayer.lastMoveSeq = seq;
      }
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
    const seq = Number(payload?.actionSeq);
    const handled = this.localSimulator.handleInteract(playerId, { x, y });
    let ackApplied = false;
    if (Number.isFinite(seq)) {
      const simPlayer = this.localSimulator.getPlayer(playerId);
      if (simPlayer && (!Number.isFinite(simPlayer.lastActionSeq) || seq > simPlayer.lastActionSeq)) {
        simPlayer.lastActionSeq = seq;
        ackApplied = true;
      }
    }
    if (handled || ackApplied) {
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
    const targetInterval = 50;
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
    this.moveSequence += 1;
    const seq = this.moveSequence;
    this.recordPendingMove(seq, this.localPosition.x, this.localPosition.y);
    this.socket.emit('move', {
      room: window.roomName,
      playerId: window.playerId,
      x: this.localPosition.x,
      y: this.localPosition.y,
      seq,
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
    clone.lastMoveSeq = Number(player.lastMoveSeq) || 0;
    clone.lastActionSeq = Number(player.lastActionSeq) || 0;
    return clone;
  }

  recordPendingMove(seq, x, y) {
    if (this.isHost) {
      return;
    }
    if (!Number.isFinite(seq) || seq <= 0) {
      return;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    if (!Array.isArray(this.pendingMoves)) {
      this.pendingMoves = [];
    }
    this.pendingMoves.push({ seq, x, y });
    const maxBuffered = 90;
    if (this.pendingMoves.length > maxBuffered) {
      this.pendingMoves.splice(0, this.pendingMoves.length - maxBuffered);
    }
  }

  cloneItems(items) {
    return items.map((item) => ({ ...item }));
  }

  recordPendingAction(action) {
    if (this.isHost) {
      return;
    }
    if (!action || !Number.isFinite(Number(action.seq)) || Number(action.seq) <= 0) {
      return;
    }
    if (!Array.isArray(this.pendingActions)) {
      this.pendingActions = [];
    }
    this.pendingActions.push(action);
    const maxBuffered = 60;
    if (this.pendingActions.length > maxBuffered) {
      this.pendingActions.splice(0, this.pendingActions.length - maxBuffered);
    }
  }

  applyLocalInteractionPrediction(action) {
    if (this.isHost) {
      return false;
    }
    if (!this.serverState || !window.playerId) {
      return false;
    }
    const simulator = this.ensurePredictionSimulator();
    simulator.loadState(this.serverState);
    const handled = simulator.handleInteract(window.playerId, {
      x: action?.x,
      y: action?.y,
    });
    let changed = handled;
    const seqNum = Number(action?.seq);
    if (Number.isFinite(seqNum)) {
      const simPlayer = simulator.getPlayer(window.playerId);
      if (simPlayer && (!Number.isFinite(simPlayer.lastActionSeq) || seqNum > simPlayer.lastActionSeq)) {
        simPlayer.lastActionSeq = seqNum;
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }
    const predicted = simulator.getDisplayState();
    if (!predicted) {
      return false;
    }
    this.serverState = predicted;
    const me = predicted.players?.[window.playerId];
    if (me && Number.isFinite(me.x) && Number.isFinite(me.y)) {
      this.applyReconciledPosition(me.x, me.y);
      this.lastSentPosition = { x: me.x, y: me.y };
    }
    this.setPendingUiState(predicted);
    return true;
  }
}
