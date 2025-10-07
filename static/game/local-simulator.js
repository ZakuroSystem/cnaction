const STATE_LABELS = {
  raw: '生',
  chopped: 'カット済み',
  cut: 'カット済み',
  cooked: '焼き上がり',
  toasted: 'トースト済み',
  assembled: '完成',
};

const ITEM_LIBRARY = {
  ingredient_burger_buns: {
    name: 'バンズ',
    defaultState: 'raw',
    states: {
      raw: { label: 'そのまま', image: '/static/new_items/burger_buns.png' },
      toasted: { label: 'トースト', image: '/static/new_items/burger_buns.png' },
    },
  },
  ingredient_beef_patty: {
    name: 'ビーフパティ',
    defaultState: 'raw',
    states: {
      raw: { label: '生', image: '/static/new_items/beef_patty.png' },
      cooked: { label: 'グリル済み', image: '/static/new_items/grilled_beef_patty.png' },
    },
  },
  ingredient_lettuce: {
    name: 'レタス',
    defaultState: 'raw',
    states: {
      raw: { label: 'そのまま', image: '/static/new_items/lettuce.png' },
      chopped: { label: '刻み', image: '/static/new_items/lettuce_cut.png' },
    },
  },
  ingredient_tomato: {
    name: 'トマト',
    defaultState: 'raw',
    states: {
      raw: { label: 'そのまま', image: '/static/new_items/TMT.png' },
      chopped: { label: 'スライス', image: '/static/new_items/TMT_slice.png' },
    },
  },
  dish_plain_burger: {
    name: 'プレーンバーガー',
    dish: 'プレーンバーガー',
    defaultState: 'assembled',
    states: {
      assembled: { label: '完成', image: '/static/new_items/hamburger.png' },
    },
    components: [
      { type: 'ingredient_burger_buns', state: 'toasted' },
      { type: 'ingredient_beef_patty', state: 'cooked' },
    ],
  },
  dish_lettuce_burger: {
    name: 'レタスバーガー',
    dish: 'レタスバーガー',
    defaultState: 'assembled',
    states: {
      assembled: { label: '完成', image: '/static/new_items/hamburger.png' },
    },
    components: [
      { type: 'ingredient_burger_buns', state: 'toasted' },
      { type: 'ingredient_beef_patty', state: 'cooked' },
      { type: 'ingredient_lettuce', state: 'chopped' },
    ],
  },
  dish_tomato_burger: {
    name: 'トマトバーガー',
    dish: 'トマトバーガー',
    defaultState: 'assembled',
    states: {
      assembled: { label: '完成', image: '/static/new_items/hamburger.png' },
    },
    components: [
      { type: 'ingredient_burger_buns', state: 'toasted' },
      { type: 'ingredient_beef_patty', state: 'cooked' },
      { type: 'ingredient_tomato', state: 'chopped' },
    ],
  },
  dish_deluxe_burger: {
    name: 'デラックスバーガー',
    dish: 'デラックスバーガー',
    defaultState: 'assembled',
    states: {
      assembled: { label: '完成', image: '/static/new_items/hamburger.png' },
    },
    components: [
      { type: 'ingredient_burger_buns', state: 'toasted' },
      { type: 'ingredient_beef_patty', state: 'cooked' },
      { type: 'ingredient_lettuce', state: 'chopped' },
      { type: 'ingredient_tomato', state: 'chopped' },
    ],
  },
};

const COOKING_RECIPES = [
  {
    type: 'ingredient_burger_buns',
    from: 'raw',
    to: 'toasted',
    action: 'bake',
    duration: 2.5,
    display: 'バンズをトーストしている…',
  },
  {
    type: 'ingredient_beef_patty',
    from: 'raw',
    to: 'cooked',
    action: 'bake',
    duration: 3.5,
    display: 'パティを焼いている…',
  },
  {
    type: 'ingredient_lettuce',
    from: 'raw',
    to: 'chopped',
    action: 'cut',
    duration: 2.0,
    display: 'レタスを刻んでいる…',
  },
  {
    type: 'ingredient_tomato',
    from: 'raw',
    to: 'chopped',
    action: 'cut',
    duration: 2.5,
    display: 'トマトをスライスしている…',
  },
];

const COMBINATION_RECIPES = [
  {
    inputs: [
      { type: 'ingredient_burger_buns', state: 'toasted' },
      { type: 'ingredient_beef_patty', state: 'cooked' },
    ],
    result: { type: 'dish_plain_burger', state: 'assembled' },
    name: 'プレーンバーガー',
  },
  {
    inputs: [
      { type: 'dish_plain_burger', state: 'assembled' },
      { type: 'ingredient_lettuce', state: 'chopped' },
    ],
    result: { type: 'dish_lettuce_burger', state: 'assembled' },
    name: 'レタスバーガー',
  },
  {
    inputs: [
      { type: 'dish_plain_burger', state: 'assembled' },
      { type: 'ingredient_tomato', state: 'chopped' },
    ],
    result: { type: 'dish_tomato_burger', state: 'assembled' },
    name: 'トマトバーガー',
  },
  {
    inputs: [
      { type: 'dish_lettuce_burger', state: 'assembled' },
      { type: 'ingredient_tomato', state: 'chopped' },
    ],
    result: { type: 'dish_deluxe_burger', state: 'assembled' },
    name: 'デラックスバーガー',
  },
  {
    inputs: [
      { type: 'dish_tomato_burger', state: 'assembled' },
      { type: 'ingredient_lettuce', state: 'chopped' },
    ],
    result: { type: 'dish_deluxe_burger', state: 'assembled' },
    name: 'デラックスバーガー',
  },
];

function itemDefinition(type) {
  return ITEM_LIBRARY[type] || {};
}

function ingredientTypes() {
  return Object.keys(ITEM_LIBRARY).filter((key) => key.startsWith('ingredient_'));
}

function dishTypes() {
  return Object.keys(ITEM_LIBRARY).filter((key) => ITEM_LIBRARY[key]?.dish);
}

function defaultItemState(type) {
  return itemDefinition(type).defaultState || 'raw';
}

function formatItemDisplay(type, state) {
  const def = itemDefinition(type);
  const base = def.name || type || '';
  const stateInfo = def.states?.[state];
  const label = stateInfo?.label || STATE_LABELS[state] || state || '';
  if (!label) {
    return base;
  }
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

function matchRequirement(type, state, requirement) {
  if (!requirement) return false;
  if (requirement.type && requirement.type !== type) {
    return false;
  }
  if (requirement.state && requirement.state !== state) {
    return false;
  }
  return true;
}

function findCombinationRecipe(recipes, typeA, stateA, typeB, stateB) {
  if (!Array.isArray(recipes)) return null;
  for (const recipe of recipes) {
    const inputs = Array.isArray(recipe.inputs) ? recipe.inputs : [];
    if (inputs.length !== 2) continue;
    const [first, second] = inputs;
    if (
      matchRequirement(typeA, stateA, first) &&
      matchRequirement(typeB, stateB, second)
    ) {
      return recipe;
    }
    if (
      matchRequirement(typeA, stateA, second) &&
      matchRequirement(typeB, stateB, first)
    ) {
      return recipe;
    }
  }
  return null;
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
          const task = { ...zone.cooking, id };
          if (!Number.isFinite(task.startedAt)) {
            task.startedAt = nowSeconds();
          }
          cloned.cooking = task;
          const info = {
            zoneIndex: index,
            task,
            startedAt: Number(task.startedAt) || nowSeconds(),
          };
          if (task.result_item_id) {
            info.resultItemId = task.result_item_id;
            info.spawnedAt = Number(task.finishedAt) || info.startedAt;
          }
          if (task.burned) {
            info.burned = true;
            info.burnDisplayAt = Number(task.burnedAt) || nowSeconds();
          }
          this.cookingTasks.set(id, info);
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
            const info = itemDefinition(updated.itemType);
            const img = this.resolveItemImage(updated.itemType, info.defaultState);
            if (img) {
              updated.image = img;
            }
          }
          if ((!updated.components || !updated.componentItems) && updated.itemType) {
            const info = itemDefinition(updated.itemType);
            const componentMeta = [];
            (info.components || []).forEach((component) => {
              const compType = component.type;
              const compState = component.state;
              componentMeta.push({
                type: compType,
                state: compState,
                label: formatItemDisplay(compType, compState),
                image: this.resolveItemImage(compType, compState),
              });
            });
            if (componentMeta.length) {
              updated.componentItems = componentMeta;
              updated.components = componentMeta.map((c) => c.label);
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
      const prevProgress = Number(task.progress);
      const prevRemaining = Number(task.remaining);
      const remaining = info.resultItemId ? 0 : Math.max(duration - elapsed, 0);
      let changed = false;
      if (!Number.isFinite(prevProgress) || Math.abs(prevProgress - progress) > 1e-3) {
        changed = true;
      }
      if (!Number.isFinite(prevRemaining) || Math.abs(prevRemaining - remaining) > 1e-3) {
        changed = true;
      }
      task.progress = progress;
      task.elapsed = elapsed;
      task.remaining = remaining;

      if (!info.resultItemId && progress >= 1) {
        const display = task.result_display || formatItemDisplay(task.result_type, task.result_state);
        const newItem = {
          id: this.state.nextItemId,
          type: task.result_type,
          x: zone.x,
          y: zone.y,
          state: task.result_state,
          display,
        };
        this.state.nextItemId += 1;
        this.state.items.push(newItem);
        zone.occupied = false;
        task.displayText = display;
        task.result_item_id = newItem.id;
        task.finishedAt = now;
        info.resultItemId = newItem.id;
        info.spawnedAt = now;
        this.dirty = true;
        continue;
      }

      if (info.resultItemId && !info.burned) {
        const stillPresent = this.state.items.some((itm) => itm.id === info.resultItemId);
        if (!stillPresent) {
          delete zone.cooking;
          this.cookingTasks.delete(taskId);
          this.dirty = true;
          continue;
        }
        const burnable = (
          task.result_type === 'ingredient_beef_patty' &&
          (task.result_state == null || task.result_state === 'cooked')
        );
        const burnLimit = burnable ? duration * 4 : 0;
        if (burnLimit > 0 && elapsed >= burnLimit) {
          this.state.items = this.state.items.filter((itm) => itm.id !== info.resultItemId);
          task.displayText = '消し炭になってしまった！';
          task.progress = 0;
          task.remaining = 0;
          task.burned = true;
          info.burned = true;
          info.burnDisplayAt = now;
          this.dirty = true;
          continue;
        }
      }

      if (info.burned) {
        const shownFor = now - (info.burnDisplayAt || now);
        if (shownFor >= 1.5) {
          delete zone.cooking;
          this.cookingTasks.delete(taskId);
          this.dirty = true;
        }
      }

      if (changed) {
        this.dirty = true;
      }
    }
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
    if (this.tryCombine(player, posX, posY)) {
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
    const choices = ingredientTypes();
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
      const state = defaultItemState(wanted);
      const newItem = {
        id: this.state.nextItemId,
        type: wanted,
        x,
        y,
        state,
        display: formatItemDisplay(wanted, state),
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
    const cfg = this.state.config || {};
    const recipes = Array.isArray(cfg.cookingRecipes) && cfg.cookingRecipes.length
      ? cfg.cookingRecipes
      : COOKING_RECIPES;
    for (const recipe of recipes) {
      if (!recipe || recipe.type !== item.type) continue;
      const fromState = recipe.from;
      if (fromState && fromState !== item.state) {
        continue;
      }
      const action = recipe.action;
      const resultState = recipe.to ?? item.state;
      if (!action || resultState == null) {
        continue;
      }
      const resultType = recipe.resultType || item.type;
      const baseDuration = action === 'cut'
        ? Number(cfg.cutDuration) || 2.0
        : Number(cfg.bakeDuration) || 3.0;
      const duration = Number(recipe.duration) || baseDuration;
      return {
        action,
        resultState,
        resultType,
        duration,
        display: recipe.display,
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
        displayText:
          actionInfo.display ||
          zone.display ||
          (actionInfo.action === 'cut' ? '切っている…' : '焼いている…'),
        result_type: actionInfo.resultType,
        result_state: actionInfo.resultState,
        result_display: formatItemDisplay(actionInfo.resultType, actionInfo.resultState),
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

  tryCombine(player, x, y) {
    const item = player.currentItem;
    if (!item) return false;
    const cfg = this.state.config || {};
    const recipes = Array.isArray(cfg.combinationRecipes) && cfg.combinationRecipes.length
      ? cfg.combinationRecipes
      : COMBINATION_RECIPES;
    for (let i = 0; i < this.state.items.length; i += 1) {
      const other = this.state.items[i];
      if (other === item) continue;
      if (distanceSquared(other.x, other.y, x, y) > 60 * 60) {
        continue;
      }
      const recipe = findCombinationRecipe(recipes, item.type, item.state, other.type, other.state);
      if (!recipe) {
        continue;
      }
      const result = recipe.result || {};
      const resultType = result.type;
      if (!resultType) {
        continue;
      }
      const resultState = result.state || defaultItemState(resultType);
      this.state.items.splice(i, 1);
      const combined = {
        id: this.state.nextItemId,
        type: resultType,
        x,
        y,
        state: resultState,
        display: formatItemDisplay(resultType, resultState),
      };
      this.state.nextItemId += 1;
      player.currentItem = combined;
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
    const mapping = this.state.config?.orderMapping || {};
    const delivered = mapping[item.type];
    if (!delivered) {
      return false;
    }
    const expectedState = item.type.startsWith('dish_')
      ? defaultItemState(item.type)
      : 'cooked';
    if (expectedState && item.state !== expectedState) {
      return false;
    }
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
    const mapping = cfg.orderMapping || {};
    let availableTypes = Object.keys(mapping);
    if (!availableTypes.length) {
      availableTypes = dishTypes();
    }
    const itemType = availableTypes.length ? randomChoice(availableTypes) : null;
    const info = itemType ? itemDefinition(itemType) : {};
    const dish = (itemType && mapping[itemType]) || info.dish || info.name || '';
    const limit = Number(cfg.orderTimeLimit) || 30;
    const order = {
      dish,
      remaining: limit,
    };
    if (itemType) {
      order.itemType = itemType;
      const image = this.resolveItemImage(itemType, info.defaultState);
      if (image) {
        order.image = image;
      }
      const components = (info.components || []).map((component) => ({
        type: component.type,
        state: component.state,
        label: formatItemDisplay(component.type, component.state),
        image: this.resolveItemImage(component.type, component.state),
      }));
      if (components.length) {
        order.componentItems = components;
        order.components = components.map((c) => c.label);
      }
    }
    return order;
  }

  resolveOrderItemType(dish) {
    const mapping = this.state.config?.orderMapping || {};
    return Object.entries(mapping).find(([, value]) => value === dish)?.[0] || null;
  }

  resolveItemImage(itemType, state) {
    if (!itemType) return null;
    const custom = (this.state.config?.customItems || []).find(
      (item) => item?.type === itemType && item.image,
    );
    if (custom?.image) {
      return custom.image;
    }
    const def = itemDefinition(itemType);
    const stateKey = state || def.defaultState;
    if (stateKey && def.states?.[stateKey]?.image) {
      return def.states[stateKey].image;
    }
    if (def.states) {
      for (const value of Object.values(def.states)) {
        if (value?.image) {
          return value.image;
        }
      }
    }
    return null;
  }
}
