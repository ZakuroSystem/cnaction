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
    this.keyState = {};
    this.spaceDown = false;
    this.lastFrame = performance.now();
    this.lastMoveSent = 0;
    this.frameHandle = null;

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
    this.serverState = state;
    if (state.players && window.playerId && state.players[window.playerId]) {
      const me = state.players[window.playerId];
      if (!this.localPosition) {
        this.localPosition = { x: me.x, y: me.y };
      } else {
        this.localPosition.x = me.x;
        this.localPosition.y = me.y;
      }
    }

    this.ui.update(state, window.playerId);
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
    if (!this.serverState || !window.playerId) return;
    const me = this.serverState.players?.[window.playerId];
    if (!me) return;

    if (!this.localPosition) {
      this.localPosition = { x: me.x, y: me.y };
    }

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

    if (vx !== 0 || vy !== 0) {
      const speed = 220;
      const len = Math.hypot(vx, vy) || 1;
      this.localPosition.x += (vx / len) * speed * dt;
      this.localPosition.y += (vy / len) * speed * dt;
      this.localPosition.x = Math.max(0, Math.min(this.canvas.width, this.localPosition.x));
      this.localPosition.y = Math.max(0, Math.min(this.canvas.height, this.localPosition.y));
      const now = performance.now();
      if (now - this.lastMoveSent > 50) {
        this.lastMoveSent = now;
        this.socket.emit('move', {
          room: window.roomName,
          playerId: window.playerId,
          x: this.localPosition.x,
          y: this.localPosition.y,
        });
      }
    }
  }

  render() {
    this.renderer.render(this.serverState, window.playerId);
  }
}
