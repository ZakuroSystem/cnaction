const socket = io();

class AssetCache {
  constructor() {
    this.cache = new Map();
    this.errorTokens = new Set();
  }

  get(key) {
    if (!key) {
      return null;
    }
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    const path = this.resolvePath(key);
    const img = new Image();
    img.src = path;
    img.onerror = () => {
      if (!this.errorTokens.has(path)) {
        console.warn(`[AssetCache] failed to load ${path}`);
        this.errorTokens.add(path);
      }
    };
    this.cache.set(key, img);
    return img;
  }

  resolvePath(key) {
    if (!key) return '';
    if (key.startsWith('http://') || key.startsWith('https://') || key.startsWith('/')) {
      return key;
    }
    if (key.startsWith('ingredient_')) {
      return `/static/assets/ingredient/${key.replace('ingredient_', '')}.png`;
    }
    if (key.startsWith('player')) {
      return `/static/assets/player/${key}.png`;
    }
    if (key.startsWith('obstacle')) {
      return `/static/assets/obstacle/${key}.png`;
    }
    if (key === 'background') {
      return '/static/assets/background/kitchen.png';
    }
    if (key === 'delivery_zone') {
      return '/static/assets/delivery_zone.png';
    }
    if (key === 'food_generator') {
      return '/static/assets/food_generator.png';
    }
    if (key === 'sourceImage') {
      return '/static/assets/sourceImage.png';
    }
    if (key === 'destinationImage') {
      return '/static/assets/destinationImage.png';
    }
    return `/static/assets/${key}.png`;
  }
}

class MobileControls {
  constructor(game) {
    this.game = game;
    this.container = document.getElementById('mobile-controls');
    this.handlers = [];
    this.boundUpdateVisibility = this.updateVisibility.bind(this);
    this.mediaQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;

    if (!this.container) {
      return;
    }

    window.addEventListener('resize', this.boundUpdateVisibility);
    window.addEventListener('orientationchange', this.boundUpdateVisibility);
    if (this.mediaQuery) {
      if (this.mediaQuery.addEventListener) {
        this.mediaQuery.addEventListener('change', this.boundUpdateVisibility);
      } else if (this.mediaQuery.addListener) {
        this.mediaQuery.addListener(this.boundUpdateVisibility);
      }
    }

    this.bindButtons();
    this.updateVisibility();
  }

  bindButtons() {
    this.bindMovement('up', ['ArrowUp', 'KeyW']);
    this.bindMovement('down', ['ArrowDown', 'KeyS']);
    this.bindMovement('left', ['ArrowLeft', 'KeyA']);
    this.bindMovement('right', ['ArrowRight', 'KeyD']);

    const interact = this.container?.querySelector('[data-action="interact"]');
    if (interact) {
      const onDown = (event) => {
        event.preventDefault();
        interact.classList.add('is-active');
        this.game.emitInteract();
      };
      const onUp = (event) => {
        event.preventDefault();
        interact.classList.remove('is-active');
      };
      this.addListener(interact, 'pointerdown', onDown, { passive: false });
      ['pointerup', 'pointerleave', 'pointercancel', 'pointerout'].forEach((type) => {
        this.addListener(interact, type, onUp, { passive: false });
      });
    }
  }

  bindMovement(action, keyCodes) {
    const button = this.container?.querySelector(`[data-action="${action}"]`);
    if (!button) return;

    const onDown = (event) => {
      event.preventDefault();
      button.classList.add('is-active');
      keyCodes.forEach((code) => this.game.setKeyState(code, true));
    };
    const onUp = (event) => {
      event.preventDefault();
      button.classList.remove('is-active');
      keyCodes.forEach((code) => this.game.setKeyState(code, false));
    };

    this.addListener(button, 'pointerdown', onDown, { passive: false });
    ['pointerup', 'pointerleave', 'pointercancel', 'pointerout'].forEach((type) => {
      this.addListener(button, type, onUp, { passive: false });
    });
  }

  addListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.handlers.push({ target, type, handler, options });
  }

  updateVisibility() {
    if (!this.container) return;
    const coarsePointer = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;
    const narrowScreen = window.innerWidth <= 900;
    const shouldShow = coarsePointer || narrowScreen;

    if (shouldShow) {
      this.container.classList.add('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'false');
    } else {
      this.container.classList.remove('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'true');
    }
  }

  destroy() {
    this.handlers.forEach(({ target, type, handler, options }) => {
      target.removeEventListener(type, handler, options);
    });
    this.handlers = [];

    window.removeEventListener('resize', this.boundUpdateVisibility);
    window.removeEventListener('orientationchange', this.boundUpdateVisibility);
    if (this.mediaQuery) {
      if (this.mediaQuery.removeEventListener) {
        this.mediaQuery.removeEventListener('change', this.boundUpdateVisibility);
      } else if (this.mediaQuery.removeListener) {
        this.mediaQuery.removeListener(this.boundUpdateVisibility);
      }
    }

    if (this.container) {
      this.container.classList.remove('mobile-controls--visible');
      this.container.setAttribute('aria-hidden', 'true');
    }
  }
}

class GameClient {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 800;
    this.canvas.height = 600;
    this.canvas.tabIndex = 0;
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.assets = new AssetCache();
    this.serverState = null;
    this.localPosition = null;
    this.keyState = {};
    this.spaceDown = false;
    this.lastFrame = performance.now();
    this.lastMoveSent = 0;
    this.frameHandle = null;

    this.orderListEl = document.getElementById('order-list');
    this.timerEl = document.getElementById('timer');
    this.scoreEl = document.getElementById('score');
    this.inventoryEl = document.getElementById('inventory');

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundStateUpdate = this.handleStateUpdate.bind(this);
    this.boundForceDisconnect = this.handleForceDisconnect.bind(this);

    this.mobileControls = new MobileControls(this);
  }

  start() {
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);

    socket.off('state_update', this.boundStateUpdate);
    socket.off('force_disconnect', this.boundForceDisconnect);
    socket.on('state_update', this.boundStateUpdate);
    socket.on('force_disconnect', this.boundForceDisconnect);

    const payload = { room: String(window.roomName || 'room1') };
    socket.emit('join', payload, (data) => {
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
    socket.off('state_update', this.boundStateUpdate);
    socket.off('force_disconnect', this.boundForceDisconnect);
    if (this.mobileControls) {
      this.mobileControls.destroy();
      this.mobileControls = null;
    }
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

    this.updateUI(state);
  }

  handleForceDisconnect() {
    alert('サーバーから切断されました。再度接続してください。');
    this.destroy();
    document.getElementById('start-overlay').style.display = 'block';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('ui').style.display = 'none';
  }

  updateUI(state) {
    if (this.timerEl) {
      this.timerEl.textContent = `タイマー: ${Math.max(0, state.timer ?? 0)}`;
    }
    if (this.scoreEl) {
      this.scoreEl.textContent = `スコア: ${state.score ?? 0}`;
    }

    const me = state.players?.[window.playerId];
    if (this.inventoryEl) {
      if (me?.currentItem) {
        const ci = me.currentItem;
        const stateLabel = ci.state === 'raw' ? '生' : ci.state === 'chopped' ? '切った' : ci.state === 'cooked' ? '調理済み' : ci.state;
        const disp = ci.display || `${ci.type} (${stateLabel})`;
        this.inventoryEl.textContent = `持ち物: ${disp}`;
      } else {
        this.inventoryEl.textContent = '持ち物: なし';
      }
    }

    if (state.gameOver) {
      const ui = document.getElementById('ui');
      if (ui) {
        ui.innerHTML = `<h2>ゲーム終了</h2><p>スコア: ${state.score}</p>`;
      }
    } else {
      this.renderOrders(state);
    }
  }

  renderOrders(state) {
    if (!this.orderListEl) return;
    const listEl = this.orderListEl;
    const frag = document.createDocumentFragment();
    const limit = state.config?.orderTimeLimit ?? null;

    state.orders.forEach((order, index) => {
      const card = document.createElement('div');
      card.className = 'order-card';

      const thumb = document.createElement('div');
      thumb.className = 'order-card__thumb';
      const iconSrc = this.getOrderIcon(order);
      if (iconSrc) {
        const img = document.createElement('img');
        img.src = iconSrc;
        img.alt = order.dish || 'オーダー';
        img.loading = 'lazy';
        thumb.appendChild(img);
      } else {
        thumb.classList.add('order-card__thumb--placeholder');
        thumb.setAttribute('aria-hidden', 'true');
      }

      const details = document.createElement('div');
      details.className = 'order-card__details';

      const name = document.createElement('div');
      name.className = 'order-card__name';
      const dish = order.dish || '???';
      name.textContent = `${index + 1}. ${dish}`;
      name.title = dish;

      const timer = document.createElement('div');
      timer.className = 'order-card__timer';
      timer.setAttribute('role', 'progressbar');

      const bar = document.createElement('div');
      bar.className = 'order-card__timer-bar';

      const remaining = Math.max(order.remaining ?? 0, 0);
      const baseLimit = limit ?? Math.max(remaining, 1);
      const ratio = baseLimit > 0 ? Math.min(Math.max(remaining / baseLimit, 0), 1) : 0;
      bar.style.width = `${ratio * 100}%`;
      if (ratio < 0.34) {
        bar.style.background = 'linear-gradient(90deg, #ef5350, #e53935)';
      } else if (ratio < 0.67) {
        bar.style.background = 'linear-gradient(90deg, #ffa726, #fb8c00)';
      }

      timer.setAttribute('aria-valuemin', '0');
      timer.setAttribute('aria-valuemax', baseLimit.toString());
      timer.setAttribute('aria-valuenow', remaining.toString());
      timer.setAttribute('aria-label', `${dish} 残り ${remaining} 秒`);

      timer.appendChild(bar);
      details.appendChild(name);
      details.appendChild(timer);

      card.appendChild(thumb);
      card.appendChild(details);
      frag.appendChild(card);
    });

    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }

  getOrderIcon(order) {
    if (!order) return null;
    if (order.image) return order.image;
    if (order.itemType) {
      const base = order.itemType.replace(/^ingredient_/, '');
      return `/static/assets/ingredient/${base}.png`;
    }
    return null;
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
    return code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD';
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
    socket.emit('interact', { room: window.roomName, playerId: window.playerId });
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
        socket.emit('move', {
          room: window.roomName,
          playerId: window.playerId,
          x: this.localPosition.x,
          y: this.localPosition.y,
        });
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const bg = this.assets.get('background');
    if (bg && bg.complete && bg.naturalWidth > 0) {
      ctx.drawImage(bg, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      ctx.fillStyle = '#263238';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    if (!this.serverState) return;

    this.renderTransfers(ctx);
    this.renderActionZones(ctx);
    this.renderDeliveryZone(ctx);
    this.renderFoodGenerators(ctx);
    this.renderItems(ctx);
    this.renderPlayers(ctx);
    this.renderCookingOverlays(ctx);
  }

  renderTransfers(ctx) {
    const transfers = this.serverState.config?.transferObjects || [];
    transfers.forEach((tr) => {
      const src = tr.sourceZone;
      const dst = tr.destination;
      if (!src || !dst) return;
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = '#4dd0e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(src.x - src.width / 2, src.y - src.height / 2, src.width, src.height);
      ctx.strokeRect(dst.x - dst.width / 2, dst.y - dst.height / 2, dst.width, dst.height);
      ctx.restore();
    });
  }

  renderActionZones(ctx) {
    const zones = this.serverState.config?.actionZones || [];
    zones.forEach((zone) => {
      ctx.save();
      const fill = zone.action === 'bake' ? 'rgba(255, 183, 77, 0.35)' : 'rgba(129, 212, 250, 0.35)';
      const stroke = zone.occupied ? '#ff7043' : '#4dd0e1';
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.fillRect(zone.x - zone.width / 2, zone.y - zone.height / 2, zone.width, zone.height);
      ctx.strokeRect(zone.x - zone.width / 2, zone.y - zone.height / 2, zone.width, zone.height);
      ctx.restore();
    });
  }

  renderDeliveryZone(ctx) {
    const dz = this.serverState.config?.deliveryZone;
    if (!dz) return;
    ctx.save();
    ctx.strokeStyle = '#ffca28';
    ctx.setLineDash([8, 4]);
    ctx.lineWidth = 3;
    ctx.strokeRect(dz.x - dz.width / 2, dz.y - dz.height / 2, dz.width, dz.height);
    ctx.restore();
  }

  renderFoodGenerators(ctx) {
    const generators = this.serverState.config?.foodGenerators || [];
    generators.forEach((fg) => {
      ctx.save();
      ctx.fillStyle = 'rgba(129, 199, 132, 0.35)';
      ctx.strokeStyle = '#66bb6a';
      ctx.lineWidth = 2;
      ctx.fillRect(fg.x - fg.width / 2, fg.y - fg.height / 2, fg.width, fg.height);
      ctx.strokeRect(fg.x - fg.width / 2, fg.y - fg.height / 2, fg.width, fg.height);
      ctx.restore();

      const img = this.assets.get(fg.nextFood);
      if (img && img.complete && img.naturalWidth > 0) {
        const size = Math.min(fg.width, fg.height, 64);
        ctx.drawImage(img, fg.x - size / 2, fg.y - size / 2, size, size);
      } else {
        this.drawPlaceholderCircle(ctx, fg.x, fg.y, Math.min(fg.width, fg.height, 60) / 2, '#66bb6a');
      }
    });
  }

  renderItems(ctx) {
    const items = this.serverState.items || [];
    items.forEach((item) => {
      const size = 72;
      const img = this.assets.get(item.type);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, item.x - size / 2, item.y - size / 2, size, size);
      } else {
        this.drawPlaceholderCircle(ctx, item.x, item.y, size / 2, '#ffab91');
      }
      if (item.display) {
        this.drawLabel(ctx, item.display, item.x, item.y + size / 2 + 16);
      }
    });
  }

  renderPlayers(ctx) {
    const players = this.serverState.players || {};
    Object.entries(players).forEach(([pid, player]) => {
      const isSelf = pid === window.playerId;
      const size = isSelf ? 80 : 70;
      const imgKey = player.image || 'player1';
      const img = this.assets.get(imgKey);
      const px = player.x;
      const py = player.y;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
      } else {
        this.drawPlaceholderCircle(ctx, px, py, size / 2, isSelf ? '#29b6f6' : '#90a4ae');
      }

      if (player.currentItem) {
        const itemImg = this.assets.get(player.currentItem.type);
        const itemSize = 48;
        if (itemImg && itemImg.complete && itemImg.naturalWidth > 0) {
          ctx.drawImage(itemImg, px - itemSize / 2, py - size / 2 - itemSize, itemSize, itemSize);
        } else {
          this.drawPlaceholderCircle(ctx, px, py - size / 2 - itemSize / 2, itemSize / 2, '#ffcc80');
        }
      }
    });
  }

  renderCookingOverlays(ctx) {
    const zones = this.serverState.config?.actionZones || [];
    zones.forEach((zone) => {
      if (!zone.cooking) return;
      const data = zone.cooking;
      const textureKey = data.texture || data.itemType || data.result_type;
      if (textureKey) {
        const img = this.assets.get(textureKey);
        const size = Math.min(96, zone.width * 0.8, zone.height * 0.8);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, zone.x - size / 2, zone.y - size / 2, size, size);
        } else {
          this.drawPlaceholderCircle(ctx, zone.x, zone.y, size / 2, '#ffe082');
        }
      }

      const label = data.displayText || '調理中…';
      this.drawLabel(ctx, label, zone.x, zone.y - zone.height / 2 - 10);

      const barWidth = Math.min(zone.width * 0.8, 180);
      const barHeight = 12;
      const barX = zone.x - barWidth / 2;
      const barY = zone.y + zone.height / 2 + 12;
      const progress = Math.max(0, Math.min(data.progress ?? 0, 1));

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      let color = '#4caf50';
      if (progress < 0.34) color = '#ef5350';
      else if (progress < 0.67) color = '#ffb74d';
      ctx.fillStyle = color;
      ctx.fillRect(barX + 2, barY + 2, (barWidth - 4) * progress, barHeight - 4);
      ctx.restore();
    });
  }

  drawPlaceholderCircle(ctx, x, y, radius, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawLabel(ctx, text, x, y) {
    ctx.save();
    ctx.font = '16px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

window.startGame = function startGame() {
  if (!window.roomName) {
    window.roomName = 'room1';
  }

  if (window.gameClient) {
    window.gameClient.destroy();
  }

  const container = document.getElementById('game-container');
  if (!container) {
    console.error('game container not found');
    return;
  }

  window.gameClient = new GameClient(container);
  window.gameClient.start();
};

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('startButton');
  if (button) {
    button.addEventListener('click', () => {
      window.startGame();
    });
  }
});
