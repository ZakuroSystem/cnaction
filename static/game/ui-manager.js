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
    this.orderCards = [];
    this.lastTimerValue = null;
    this.lastScoreValue = null;
    this.lastInventoryLabel = null;
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
    if (this.lastTimerValue === numeric) {
      return;
    }
    this.lastTimerValue = numeric;
    this.timerEl.textContent = `タイマー: ${numeric}`;
  }

  updateScore(value) {
    if (!this.scoreEl) return;
    if (this.lastScoreValue === value) {
      return;
    }
    this.lastScoreValue = value;
    this.scoreEl.textContent = `スコア: ${value}`;
  }

  updateInventory(player) {
    if (!this.inventoryEl) return;
    if (player?.currentItem) {
      const item = player.currentItem;
      const stateLabel =
        item.state === 'raw'
          ? '生'
          : item.state === 'chopped' || item.state === 'cut'
          ? '切った'
          : item.state === 'cooked'
          ? '調理済み'
          : item.state;
      const display = item.display || `${item.type} (${stateLabel})`;
      const label = `持ち物: ${display}`;
      if (label === this.lastInventoryLabel) {
        return;
      }
      this.lastInventoryLabel = label;
      this.inventoryEl.textContent = label;
    } else {
      if (this.lastInventoryLabel === '持ち物: なし') {
        return;
      }
      this.lastInventoryLabel = '持ち物: なし';
      this.inventoryEl.textContent = '持ち物: なし';
    }
  }

  renderOrders(state) {
    if (!this.orderListEl) return;
    const orders = state.orders || [];
    const limit = state.config?.orderTimeLimit ?? null;

    if (this.shouldRebuildOrderCards(orders)) {
      this.rebuildOrderCards(orders);
    }

    orders.forEach((order, index) => {
      const card = this.orderCards[index];
      if (!card) return;

      const dish = order.dish || '???';
      const label = `${index + 1}. ${dish}`;
      if (card.lastLabel !== label) {
        card.name.textContent = label;
        card.name.title = dish;
        card.lastLabel = label;
      }

      const remaining = Math.max(order.remaining ?? 0, 0);
      const baseLimit = limit ?? Math.max(remaining, 1);
      const ratio = baseLimit > 0 ? Math.min(Math.max(remaining / baseLimit, 0), 1) : 0;
      if (Math.abs(ratio - card.lastRatio) > 0.01 || card.lastRatio === null) {
        card.bar.style.width = `${ratio * 100}%`;
        if (ratio < 0.34) {
          card.bar.style.background = 'linear-gradient(90deg, #ef5350, #e53935)';
        } else if (ratio < 0.67) {
          card.bar.style.background = 'linear-gradient(90deg, #ffa726, #fb8c00)';
        } else {
          card.bar.style.background = '';
        }
        card.lastRatio = ratio;
      }

      if (card.lastRemaining !== remaining || card.lastBaseLimit !== baseLimit) {
        card.timer.setAttribute('aria-valuemin', '0');
        card.timer.setAttribute('aria-valuemax', baseLimit.toString());
        card.timer.setAttribute('aria-valuenow', remaining.toString());
        card.timer.setAttribute('aria-label', `${dish} 残り ${remaining} 秒`);
        card.lastRemaining = remaining;
        card.lastBaseLimit = baseLimit;
      }
    });
  }

  renderGameOver(score) {
    if (this.gameOverMessageEl) {
      this.gameOverMessageEl.textContent = `ゲーム終了! スコア: ${score}`;
      this.gameOverMessageEl.classList.remove('hidden');
    }

    if (this.orderListEl) {
      this.orderListEl.innerHTML = '';
    }
    this.orderCards = [];
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

  shouldRebuildOrderCards(orders) {
    if (orders.length !== this.orderCards.length) {
      return true;
    }

    return orders.some((order, index) => {
      const card = this.orderCards[index];
      if (!card) return true;
      return card.signature !== this.signatureForOrder(order);
    });
  }

  rebuildOrderCards(orders) {
    this.orderCards = orders.map((order, index) =>
      this.createOrderCard(order, index)
    );

    if (!this.orderListEl) return;
    const frag = document.createDocumentFragment();
    this.orderCards.forEach((card) => {
      frag.appendChild(card.element);
    });
    this.orderListEl.innerHTML = '';
    this.orderListEl.appendChild(frag);
  }

  createOrderCard(order, index) {
    const element = document.createElement('div');
    element.className = 'order-card';

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
    timer.appendChild(bar);

    details.appendChild(name);
    details.appendChild(timer);

    element.appendChild(thumb);
    element.appendChild(details);

    return {
      element,
      name,
      timer,
      bar,
      signature: this.signatureForOrder(order),
      lastLabel: name.textContent,
      lastRatio: null,
      lastRemaining: null,
      lastBaseLimit: null,
    };
  }

  signatureForOrder(order) {
    if (!order) return 'null';
    const payload = {
      dish: order.dish || '',
      itemType: order.itemType || '',
      image: order.image || '',
    };
    return JSON.stringify(payload);
  }
}
