const INGREDIENT_DEFS = {
  ingredient_tomato: {
    name: 'トマト',
    dish: 'トマト(切って焼いたもの)',
  },
  ingredient_lettuce: {
    name: 'レタス',
    dish: 'レタス(切って焼いたもの)',
  },
  ingredient_bread: {
    name: 'バンズ',
    dish: 'バンズ(切って焼いたもの)',
  },
};

const STATE_LABELS = {
  raw: '生',
  chopped: 'カット済み',
  cut: 'カット済み',
  cooked: '焼き上がり',
};

function ingredientTypes() {
  return Object.keys(INGREDIENT_DEFS);
}

function formatItemDisplay(type, state) {
  const base = INGREDIENT_DEFS[type]?.name || type || '';
  const label = STATE_LABELS[state] || state || '';
  return `${base} (${label})`;
}

function cloneItem(item) {
  if (!item) return null;
  return {
    id: item.id,
    type: item.type,
    x: item.x,
    y: item.y,
    state: item.state,
    display: item.display,
  };
}

function clonePlayer(player) {
  if (!player) return null;
  return {
    x: player.x,
    y: player.y,
    currentItem: cloneItem(player.currentItem),
    cooking: Boolean(player.cooking),
    currentZone: player.currentZone ? { ...player.currentZone } : null,
    base_image: player.base_image,
    image: player.image,
  };
}

function clonePlayers(players) {
  const result = {};
  Object.entries(players || {}).forEach(([pid, player]) => {
    result[pid] = clonePlayer(player);
  });
  return result;
}

function cloneItems(items) {
  return (items || []).map((item) => cloneItem(item));
}

function cloneState(state) {
  if (!state) return null;
  return {
    players: clonePlayers(state.players),
    items: cloneItems(state.items),
    orders: Array.isArray(state.orders) ? state.orders.map((o) => ({ ...o })) : [],
    score: Number(state.score) || 0,
    timer: Number(state.timer) || 0,
    gameOver: Boolean(state.gameOver),
    config: state.config ? { ...state.config } : {},
    nextItemId: Number(state.nextItemId) || 1,
    resetScheduled: Boolean(state.resetScheduled),
  };
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function inZone(x, y, zone) {
  if (!zone) return false;
  const halfW = zone.width / 2;
  const halfH = zone.height / 2;
  return (
    x >= zone.x - halfW &&
    x <= zone.x + halfW &&
    y >= zone.y - halfH &&
    y <= zone.y + halfH
  );
}

function randomChoice(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const idx = Math.floor(Math.random() * list.length);
  return list[idx];
}

function nowSeconds() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

export class LocalSimulator {
  constructor() {
    this.state = null;
    this.dirty = false;
    this.timerAccumulator = 0;
    this.orderAccumulator = 0;
    this.cookingTasks = new Map();
  }

  hasState() {
    return !!this.state;
  }

  getDisplayState() {
    return this.state ? cloneState(this.state) : null;
  }

  hasDirtyState() {
    return this.dirty;
  }

  clearDirtyState() {
    this.dirty = false;
  }

  loadState(state) {
    this.state = cloneState(state);
    this.timerAccumulator = 0;
    this.orderAccumulator = 0;
    this.cookingTasks.clear();
    if (this.state?.config?.actionZones) {
      this.state.config.actionZones = this.state.config.actionZones.map((zone, index) => {
        const cloned = { ...zone };
        if (zone.cooking) {
          const id = zone.cooking.id || `task-${index}`;
          const task = { ...zone.cooking, id, startedAt: nowSeconds() };
          cloned.cooking = task;
          this.cookingTasks.set(id, {
            zoneIndex: index,
            task,
            startedAt: task.startedAt,
          });
        }
        return cloned;
      });
    }
    this.dirty = true;
  }

  mergeServerState(state, localPlayerId) {
    if (!this.state) {
      this.loadState(state);
      return;
    }
    if (state?.config) {
      this.state.config = { ...state.config };
    }
    if (Number.isFinite(state?.nextItemId)) {
      const incomingNext = Number(state.nextItemId);
      if (incomingNext > this.state.nextItemId) {
        this.state.nextItemId = incomingNext;
      }
    }
    const incomingPlayers = state?.players || {};
    Object.entries(incomingPlayers).forEach(([pid, pdata]) => {
      const player = this.state.players[pid] || {
        x: Number(pdata?.x) || 0,
        y: Number(pdata?.y) || 0,
        currentItem: null,
        cooking: false,
        currentZone: null,
        base_image: pdata?.base_image || pid,
        image: pdata?.image || pdata?.base_image || pid,
      };
      player.base_image = pdata?.base_image || player.base_image || pid;
      player.image = pdata?.image || player.image || player.base_image;
      if (pid !== localPlayerId) {
        if (Number.isFinite(pdata?.x)) player.x = Number(pdata.x);
        if (Number.isFinite(pdata?.y)) player.y = Number(pdata.y);
        if (pdata?.currentItem) {
          player.currentItem = cloneItem(pdata.currentItem);
        } else {
          player.currentItem = null;
        }
      }
      this.state.players[pid] = player;
    });
    Object.keys(this.state.players).forEach((pid) => {
      if (!(pid in incomingPlayers)) {
        delete this.state.players[pid];
        this.dirty = true;
      }
    });
  }

  ensurePlayer(playerId) {
    if (!this.state.players[playerId]) {
      this.state.players[playerId] = {
        x: 100,
        y: 100,
        currentItem: null,
        cooking: false,
        currentZone: null,
        base_image: playerId,
        image: playerId,
      };
      this.dirty = true;
    }
    return this.state.players[playerId];
  }

  update(dt) {
    if (!this.state) return;
    this.tickTimer(dt);
    this.tickOrders(dt);
    this.updateCookingTasks();
  }

  tickTimer(dt) {
    if (!this.state || this.state.timer <= 0 || this.state.gameOver) return;
    this.timerAccumulator += dt;
    const steps = Math.floor(this.timerAccumulator);
    if (steps <= 0) return;
    this.timerAccumulator -= steps;
    const prev = this.state.timer;
    this.state.timer = Math.max(0, this.state.timer - steps);
    if (this.state.timer !== prev) {
      if (this.state.timer <= 0) {
        this.state.timer = 0;
        this.state.gameOver = true;
        this.state.items = [];
      }
      this.dirty = true;
    }
  }

  tickOrders(dt) {
    if (!this.state) return;
    this.orderAccumulator += dt;
    const steps = Math.floor(this.orderAccumulator);
    if (steps <= 0) return;
    this.orderAccumulator -= steps;
    const cfg = this.state.config || {};
    const penalty = Number(cfg.wrongOrderPenalty) || 5;
    for (let i = 0; i < steps; i += 1) {
      const nextOrders = [];
      let changed = false;
      for (const order of this.state.orders) {
        const remaining = Math.max(0, Number(order.remaining || 0) - 1);
        if (remaining <= 0) {
          this.state.score -= penalty;
          nextOrders.push(this.buildOrder());
          changed = true;
        } else {
          const updated = { ...order, remaining };
          if (!updated.itemType) {
            const itemType = this.resolveOrderItemType(updated.dish);
            if (itemType) {
              updated.itemType = itemType;
            }
          }
          if (!updated.image && updated.itemType) {
            const img = this.resolveItemImage(updated.itemType);
            if (img) {
              updated.image = img;
            }
          }
          if (remaining !== order.remaining) {
            changed = true;
          }
          nextOrders.push(updated);
        }
      }
      if (nextOrders.length) {
        this.state.orders = nextOrders;
      }
      if (changed) {
        this.dirty = true;
      }
    }
  }

  updateCookingTasks() {
    if (!this.state?.config?.actionZones) return;
    const now = nowSeconds();
    for (const [taskId, info] of Array.from(this.cookingTasks.entries())) {
      const zones = this.state.config.actionZones;
      const zone = zones[info.zoneIndex];
      if (!zone || !zone.cooking || zone.cooking.id !== taskId) {
        this.cookingTasks.delete(taskId);
        continue;
      }
      const task = zone.cooking;
      const elapsed = now - info.startedAt;
      const duration = Math.max(Number(task.duration) || 0.1, 0.1);
      const progress = Math.max(0, Math.min(elapsed / duration, 1));
      task.progress = progress;
      task.elapsed = elapsed;
      task.remaining = Math.max(duration - elapsed, 0);
      if (progress >= 1) {
        this.finishCookingTask(info.zoneIndex, zone, task);
        this.cookingTasks.delete(taskId);
        this.dirty = true;
      }
    }
  }

  finishCookingTask(zoneIndex, zone, task) {
    const newItem = {
      id: this.state.nextItemId,
      type: task.result_type,
      x: zone.x,
      y: zone.y,
      state: task.result_state,
      display: task.result_display || formatItemDisplay(task.result_type, task.result_state),
    };
    this.state.nextItemId += 1;
    this.state.items.push(newItem);
    zone.occupied = false;
    delete zone.cooking;
  }

  handleMove(playerId, x, y) {
    if (!this.state) return;
    const player = this.ensurePlayer(playerId);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const prevX = player.x;
    const prevY = player.y;
    if (Math.abs(prevX - x) < 0.1 && Math.abs(prevY - y) < 0.1) {
      return;
    }
    player.x = x;
    player.y = y;
    if (player.currentItem) {
      player.currentItem.x = x;
      player.currentItem.y = y;
    }
    this.dirty = true;
  }

  handleInteract(playerId, position) {
    if (!this.state) return false;
    const player = this.ensurePlayer(playerId);
    const x = Number(position?.x);
    const y = Number(position?.y);
    const posX = Number.isFinite(x) ? x : player.x;
    const posY = Number.isFinite(y) ? y : player.y;
    const moved = this.updatePlayerPosition(player, posX, posY);
    let changed = moved;

    if (!player.currentItem) {
      if (this.pickupNearbyItem(player, posX, posY)) {
        this.dirty = true;
        return true;
      }
      if (this.spawnFromGenerator(player, posX, posY)) {
        this.dirty = true;
        return true;
      }
      return changed;
    }

    if (this.startCooking(player, posX, posY)) {
      this.dirty = true;
      return true;
    }
    if (this.tryDeliver(player, posX, posY)) {
      this.dirty = true;
      return true;
    }
    this.dropItem(player, posX, posY);
    this.dirty = true;
    return true;
  }

  updatePlayerPosition(player, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (Math.abs(player.x - x) < 0.1 && Math.abs(player.y - y) < 0.1) {
      return false;
    }
    player.x = x;
    player.y = y;
    if (player.currentItem) {
      player.currentItem.x = x;
      player.currentItem.y = y;
    }
    return true;
  }

  pickupNearbyItem(player, x, y) {
    let grabbedIndex = -1;
    for (let i = 0; i < this.state.items.length; i += 1) {
      const item = this.state.items[i];
      if (distanceSquared(item.x, item.y, x, y) < 50 * 50) {
        grabbedIndex = i;
        break;
      }
    }
    if (grabbedIndex === -1) {
      return false;
    }
    const [item] = this.state.items.splice(grabbedIndex, 1);
    player.currentItem = { ...item };
    return true;
  }

  spawnFromGenerator(player, x, y) {
    const cfg = this.state.config || {};
    const generators = cfg.foodGenerators || [];
    if (!generators.length) return false;
    let choices = Object.keys(cfg.orderMapping || {});
    if (!choices.length) {
      choices = ingredientTypes();
    }
    if (!choices.length) {
      return false;
    }
    for (const generator of generators) {
      if (!inZone(x, y, generator)) {
        continue;
      }
      const wanted = generator.nextFood && choices.includes(generator.nextFood)
        ? generator.nextFood
        : randomChoice(choices);
      if (!wanted) {
        continue;
      }
      const newItem = {
        id: this.state.nextItemId,
        type: wanted,
        x,
        y,
        state: 'raw',
        display: formatItemDisplay(wanted, 'raw'),
      };
      this.state.nextItemId += 1;
      player.currentItem = newItem;
      generator.nextFood = randomChoice(choices) || wanted;
      return true;
    }
    return false;
  }

  resolveActionForItem(item) {
    if (!item) return null;
    if (!item.state || item.state === 'raw') {
      return {
        action: 'cut',
        resultState: 'chopped',
        duration: Number(this.state.config?.cutDuration) || 2.0,
      };
    }
    if (item.state === 'chopped' || item.state === 'cut') {
      return {
        action: 'bake',
        resultState: 'cooked',
        duration: Number(this.state.config?.bakeDuration) || 3.0,
      };
    }
    return null;
  }

  startCooking(player, x, y) {
    const item = player.currentItem;
    const actionInfo = this.resolveActionForItem(item);
    if (!item || !actionInfo) return false;
    const zones = this.state.config?.actionZones || [];
    for (let i = 0; i < zones.length; i += 1) {
      const zone = zones[i];
      if (zone.action !== actionInfo.action || zone.occupied) {
        continue;
      }
      if (!inZone(x, y, zone)) {
        continue;
      }
      zone.occupied = true;
      player.currentItem = null;
      player.cooking = false;
      player.currentZone = null;
      player.image = player.base_image;
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `cook-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const task = {
        id,
        progress: 0,
        duration: Math.max(actionInfo.duration, 0.1),
        texture: item.type,
        itemType: item.type,
        displayText: zone.display || (actionInfo.action === 'cut' ? '切っている…' : '焼いている…'),
        result_type: item.type,
        result_state: actionInfo.resultState,
        result_display: formatItemDisplay(item.type, actionInfo.resultState),
        startedAt: nowSeconds(),
      };
      zone.cooking = task;
      this.cookingTasks.set(id, {
        zoneIndex: i,
        task,
        startedAt: task.startedAt,
      });
      return true;
    }
    return false;
  }

  tryDeliver(player, x, y) {
    const item = player.currentItem;
    if (!item) return false;
    const deliveryZone = this.state.config?.deliveryZone;
    if (!deliveryZone || !inZone(x, y, deliveryZone)) {
      return false;
    }
    if (item.state !== 'cooked') {
      return false;
    }
    const mapping = this.state.config?.orderMapping || {};
    const delivered = mapping[item.type] || formatItemDisplay(item.type, item.state);
    const expected = this.state.orders[0]?.dish;
    if (delivered === expected) {
      this.state.score += 10;
      this.state.orders.shift();
      this.state.orders.push(this.buildOrder());
    } else {
      const penalty = Number(this.state.config?.wrongOrderPenalty) || 5;
      this.state.score -= penalty;
    }
    player.currentItem = null;
    return true;
  }

  dropItem(player, x, y) {
    const item = player.currentItem;
    if (!item) return;
    item.x = x;
    item.y = y;
    item.id = this.state.nextItemId;
    this.state.nextItemId += 1;
    item.display = formatItemDisplay(item.type, item.state);
    const transfers = this.state.config?.transferObjects || [];
    for (const transfer of transfers) {
      const src = transfer.sourceZone;
      const dest = transfer.destination;
      if (!src || !dest) continue;
      if (inZone(x, y, src)) {
        item.x = dest.x ?? item.x;
        item.y = dest.y ?? item.y;
        break;
      }
    }
    this.state.items.push({ ...item });
    player.currentItem = null;
  }

  buildOrder() {
    const cfg = this.state.config || {};
    let dishes = Array.isArray(cfg.dishList) ? cfg.dishList.slice() : [];
    if (!dishes.length) {
      dishes = ingredientTypes().map((key) => INGREDIENT_DEFS[key]?.dish).filter(Boolean);
    }
    const dish = dishes.length ? randomChoice(dishes) : '';
    const limit = Number(cfg.orderTimeLimit) || 30;
    const order = {
      dish,
      remaining: limit,
    };
    const itemType = this.resolveOrderItemType(dish);
    if (itemType) {
      order.itemType = itemType;
      const image = this.resolveItemImage(itemType);
      if (image) {
        order.image = image;
      }
    }
    return order;
  }

  resolveOrderItemType(dish) {
    const mapping = this.state.config?.orderMapping || {};
    return Object.entries(mapping).find(([, value]) => value === dish)?.[0] || null;
  }

  resolveItemImage(itemType) {
    if (!itemType) return null;
    const custom = (this.state.config?.customItems || []).find(
      (item) => item?.type === itemType && item.image,
    );
    return custom?.image || null;
  }
}
