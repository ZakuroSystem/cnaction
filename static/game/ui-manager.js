export class UIManager {
  constructor({
    timerEl,
    scoreEl,
    inventoryEl,
    orderListEl,
    gameOverMessageEl,
  }) {
    this.timerEl = timerEl || null;
    this.scoreEl = scoreEl || null;
    this.inventoryEl = inventoryEl || null;
    this.orderListEl = orderListEl || null;
    this.gameOverMessageEl = gameOverMessageEl || null;
  }

  update(state, playerId) {
    if (!state) return;

    this.updateTimer(state.timer ?? 0);
    this.updateScore(state.score ?? 0);
    this.updateInventory(state.players?.[playerId]);

    if (state.gameOver) {
      this.renderGameOver(state.score ?? 0);
    } else {
      this.hideGameOver();
      this.renderOrders(state);
    }
  }

  updateTimer(value) {
    if (!this.timerEl) return;
    const numeric = Math.max(0, Math.floor(value));
    this.timerEl.textContent = `タイマー: ${numeric}`;
  }

  updateScore(value) {
    if (!this.scoreEl) return;
    this.scoreEl.textContent = `スコア: ${value}`;
  }

  updateInventory(player) {
    if (!this.inventoryEl) return;
    if (player?.currentItem) {
      const item = player.currentItem;
      const stateLabel =
        item.state === 'raw'
          ? '生'
          : item.state === 'chopped'
          ? '切った'
          : item.state === 'cooked'
          ? '調理済み'
          : item.state;
      const display = item.display || `${item.type} (${stateLabel})`;
      this.inventoryEl.textContent = `持ち物: ${display}`;
    } else {
      this.inventoryEl.textContent = '持ち物: なし';
    }
  }

  renderOrders(state) {
    if (!this.orderListEl) return;
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

    this.orderListEl.innerHTML = '';
    this.orderListEl.appendChild(frag);
  }

  renderGameOver(score) {
    if (this.gameOverMessageEl) {
      this.gameOverMessageEl.textContent = `ゲーム終了! スコア: ${score}`;
      this.gameOverMessageEl.classList.remove('hidden');
    }

    if (this.orderListEl) {
      this.orderListEl.innerHTML = '';
    }
  }

  hideGameOver() {
    if (this.gameOverMessageEl) {
      this.gameOverMessageEl.classList.add('hidden');
      this.gameOverMessageEl.textContent = '';
    }
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
}
