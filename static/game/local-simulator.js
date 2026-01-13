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

const INGREDIENT_TYPES = Object.freeze(
  Object.keys(ITEM_LIBRARY).filter((key) => key.startsWith('ingredient_')),
);
const DISH_TYPES = Object.freeze(
  Object.keys(ITEM_LIBRARY).filter((key) => ITEM_LIBRARY[key]?.dish),
);

function buildCookingLookup(recipes) {
  const lookup = new Map();
  (recipes || []).forEach((recipe) => {
    if (!recipe || !recipe.type) return;
    const list = lookup.get(recipe.type);
    if (list) {
      list.push(recipe);
    } else {
      lookup.set(recipe.type, [recipe]);
    }
  });
  return lookup;
}

function findCookingRecipeFromLookup(lookup, itemType, itemState) {
  if (!lookup || !itemType) return null;
  const candidates = lookup.get(itemType);
  if (!candidates) return null;
  for (const recipe of candidates) {
    if (!recipe) continue;
    const fromState = recipe.from;
    if (fromState && fromState !== itemState) {
      continue;
    }
    const action = recipe.action;
    const resultState = recipe.to;
    if (!action || resultState == null) {
      continue;
    }
    return recipe;
  }
  return null;
}

function combinationKey(type, state) {
  if (!type) return null;
  return `${type}|${state ?? ''}`;
}

function buildCombinationIndex(recipes) {
  const index = new Map();
  (recipes || []).forEach((recipe) => {
    if (!recipe) return;
    const inputs = Array.isArray(recipe.inputs) ? recipe.inputs : [];
    if (inputs.length !== 2) return;
    const normalized = inputs.map((component) => {
      if (!component || !component.type) return null;
      return { type: component.type, state: component.state ?? null };
    });
    if (normalized.some((entry) => !entry)) return;
    for (let i = 0; i < 2; i += 1) {
      const primary = normalized[i];
      const secondary = normalized[1 - i];
      const key = combinationKey(primary.type, primary.state);
      if (!key) continue;
      const bucket = index.get(key);
      const entry = { requirement: secondary, recipe };
      if (bucket) {
        bucket.push(entry);
      } else {
        index.set(key, [entry]);
      }
    }
  });
  return index;
}

function findCombinationFromIndex(index, typeA, stateA, typeB, stateB) {
  if (!index || !typeA || !typeB) return null;
  const keys = new Set();
  keys.add(combinationKey(typeA, stateA ?? null));
  keys.add(combinationKey(typeA, null));
  for (const key of keys) {
    if (!key) continue;
    const bucket = index.get(key);
    if (!bucket) continue;
    for (const entry of bucket) {
      if (matchRequirement(typeB, stateB, entry.requirement)) {
        return entry.recipe;
      }
    }
  }
  return null;
}

function buildCustomItemMap(config) {
  const map = new Map();
  const customItems = Array.isArray(config?.customItems) ? config.customItems : [];
  customItems.forEach((item) => {
    if (item && item.type && item.image) {
      map.set(item.type, item.image);
    }
  });
  return map;
}

function resolveItemImageFromConfig(config, itemType, state, customItemMap) {
  if (!itemType) return null;
  if (customItemMap?.has(itemType)) {
    return customItemMap.get(itemType);
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

function buildOrderMetadata(config) {
  const customItemMap = buildCustomItemMap(config);
  const orderImages = new Map();
  const componentCache = new Map();
  const orderLookup = new Map();
  const mapping = config?.orderMapping || {};
  Object.entries(mapping).forEach(([itemType, dish]) => {
    if (dish) {
      orderLookup.set(dish, itemType);
    }
  });
  Object.keys(ITEM_LIBRARY).forEach((itemType) => {
    const info = itemDefinition(itemType);
    const defaultState = info.defaultState || 'raw';
    const image = resolveItemImageFromConfig(config, itemType, defaultState, customItemMap);
    if (image) {
      orderImages.set(itemType, image);
    }
    const components = Array.isArray(info.components) ? info.components : [];
    if (components.length) {
      const componentMeta = components.map((component) => ({
        type: component.type,
        state: component.state,
        label: formatItemDisplay(component.type, component.state),
        image: resolveItemImageFromConfig(config, component.type, component.state, customItemMap),
      }));
      componentCache.set(itemType, {
        labels: componentMeta.map((c) => c.label),
        items: componentMeta,
      });
    }
  });
  return { customItemMap, orderImages, componentCache, orderLookup };
}

function buildRuntimeMetadata(config) {
  const cookingRecipes = Array.isArray(config?.cookingRecipes) && config.cookingRecipes.length
    ? config.cookingRecipes
    : COOKING_RECIPES;
  const combinationRecipes = Array.isArray(config?.combinationRecipes) && config.combinationRecipes.length
    ? config.combinationRecipes
    : COMBINATION_RECIPES;
  const metadata = buildOrderMetadata(config || {});
  metadata.cookingLookup = buildCookingLookup(cookingRecipes);
  metadata.combinationIndex = buildCombinationIndex(combinationRecipes);
  return metadata;
}

function hydrateOrderData(order, runtime, config) {
  if (!order) return order;
  const rt = runtime || {};
  const cfg = config || {};
  if (!order.itemType && order.dish) {
    if (rt.orderLookup?.has(order.dish)) {
      order.itemType = rt.orderLookup.get(order.dish);
    } else {
      const mapping = cfg.orderMapping || {};
      const entry = Object.entries(mapping).find(([, value]) => value === order.dish);
      if (entry) {
        order.itemType = entry[0];
      }
    }
  }
  const itemType = order.itemType;
  if (!itemType) {
    return order;
  }
  if (!order.image) {
    const image = (rt.orderImages && rt.orderImages.get(itemType))
      || resolveItemImageFromConfig(cfg, itemType, itemDefinition(itemType).defaultState, rt.customItemMap);
    if (image) {
      order.image = image;
    }
  }
  if (!order.components || !order.componentItems) {
    const cached = rt.componentCache?.get(itemType);
    if (cached) {
      order.components = [...cached.labels];
      order.componentItems = cached.items.map((item) => ({ ...item }));
    } else {
      const info = itemDefinition(itemType);
      const components = Array.isArray(info.components) ? info.components : [];
      if (components.length) {
        const meta = components.map((component) => ({
          type: component.type,
          state: component.state,
          label: formatItemDisplay(component.type, component.state),
          image: resolveItemImageFromConfig(cfg, component.type, component.state, rt.customItemMap),
        }));
        order.components = meta.map((c) => c.label);
        order.componentItems = meta;
      }
    }
  }
  return order;
}

export const PLAYFIELD_WIDTH = 800;
export const PLAYFIELD_HEIGHT = 600;
export const PLAYER_RADIUS = 32;
const COLLISION_EPSILON = 1e-6;

function itemDefinition(type) {
  return ITEM_LIBRARY[type] || {};
}

function ingredientTypes() {
  return Array.from(INGREDIENT_TYPES);
}

function dishTypes() {
  return Array.from(DISH_TYPES);
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function zoneMetrics(zone) {
  const width = Math.max(16, Number(zone?.width) || 150);
  const height = Math.max(16, Number(zone?.height) || 150);
  const halfW = width / 2;
  const halfH = height / 2;
  const x = Number(zone?.x) || 0;
  const y = Number(zone?.y) || 0;
  return {
    x,
    y,
    halfW,
    halfH,
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  };
}

function zonesForObstacle(config, obstacle) {
  const zones = [];
  const metrics = obstacleMetrics(obstacle);
  const actionZones = Array.isArray(config?.actionZones) ? config.actionZones : [];
  for (const zone of actionZones) {
    if (!zone || typeof zone !== 'object') continue;
    const zoneBox = zoneMetrics(zone);
    if (rectanglesOverlap(zoneBox, metrics)) {
      zones.push(zone);
    }
  }
  return zones;
}

function obstacleEntries(config) {
  const entries = [];
  const staticList = Array.isArray(config?.staticObstacles) ? config.staticObstacles : [];
  const movingList = Array.isArray(config?.movingObstacles) ? config.movingObstacles : [];
  [...staticList, ...movingList].forEach((obstacle) => {
    if (obstacle && typeof obstacle === 'object') {
      entries.push({ obstacle, pushable: false, zones: zonesForObstacle(config, obstacle) });
    }
  });
  return entries;
}

function obstacleMetrics(obstacle) {
  const width = Math.max(16, Number(obstacle?.width) || 96);
  const height = Math.max(16, Number(obstacle?.height) || 96);
  const halfW = width / 2;
  const halfH = height / 2;
  const x = Number(obstacle?.x) || 0;
  const y = Number(obstacle?.y) || 0;
  return {
    x,
    y,
    halfW,
    halfH,
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  };
}

function rectanglesOverlap(a, b) {
  return (
    a.left < b.right - COLLISION_EPSILON &&
    a.right > b.left + COLLISION_EPSILON &&
    a.top < b.bottom - COLLISION_EPSILON &&
    a.bottom > b.top + COLLISION_EPSILON
  );
}

function circleRectCollision(cx, cy, radius, rect) {
  const closestX = clamp(cx, rect.left, rect.right);
  const closestY = clamp(cy, rect.top, rect.bottom);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function resolveCollisionOverlap(x, y, entries) {
  let adjustedX = x;
  let adjustedY = y;
  for (const entry of entries) {
    const obstacle = entry.obstacle;
    const metrics = obstacleMetrics(obstacle);
    if (!circleRectCollision(adjustedX, adjustedY, PLAYER_RADIUS, metrics)) {
      continue;
    }
    const dxLeft = metrics.left - PLAYER_RADIUS - adjustedX;
    const dxRight = metrics.right + PLAYER_RADIUS - adjustedX;
    const dyTop = metrics.top - PLAYER_RADIUS - adjustedY;
    const dyBottom = metrics.bottom + PLAYER_RADIUS - adjustedY;
    const candidates = [
      { distance: Math.abs(dxLeft), dx: dxLeft, dy: 0 },
      { distance: Math.abs(dxRight), dx: dxRight, dy: 0 },
      { distance: Math.abs(dyTop), dx: 0, dy: dyTop },
      { distance: Math.abs(dyBottom), dx: 0, dy: dyBottom },
    ];
    candidates.sort((a, b) => a.distance - b.distance);
    adjustedX += candidates[0].dx;
    adjustedY += candidates[0].dy;
  }
  adjustedX = clamp(adjustedX, PLAYER_RADIUS, PLAYFIELD_WIDTH - PLAYER_RADIUS);
  adjustedY = clamp(adjustedY, PLAYER_RADIUS, PLAYFIELD_HEIGHT - PLAYER_RADIUS);
  return { x: adjustedX, y: adjustedY };
}

function tryMoveObstacle(entries, entry, dx, dy) {
  const obstacle = entry.obstacle;
  if (Math.abs(dx) < COLLISION_EPSILON && Math.abs(dy) < COLLISION_EPSILON) {
    return { dx: 0, dy: 0 };
  }
  const metrics = obstacleMetrics(obstacle);
  const newX = clamp(metrics.x + dx, metrics.halfW, PLAYFIELD_WIDTH - metrics.halfW);
  const newY = clamp(metrics.y + dy, metrics.halfH, PLAYFIELD_HEIGHT - metrics.halfH);
  const actualDx = newX - metrics.x;
  const actualDy = newY - metrics.y;
  const newRect = {
    left: newX - metrics.halfW,
    right: newX + metrics.halfW,
    top: newY - metrics.halfH,
    bottom: newY + metrics.halfH,
  };
  for (const otherEntry of entries) {
    const other = otherEntry.obstacle;
    if (other === obstacle) continue;
    const otherMetrics = obstacleMetrics(other);
    if (rectanglesOverlap(newRect, otherMetrics)) {
      return { dx: 0, dy: 0 };
    }
  }
  obstacle.x = newX;
  obstacle.y = newY;
  if (Math.abs(actualDx) > COLLISION_EPSILON || Math.abs(actualDy) > COLLISION_EPSILON) {
    for (const zone of entry.zones || []) {
      const prevX = Number(zone?.x) || metrics.x;
      const prevY = Number(zone?.y) || metrics.y;
      zone.x = prevX + actualDx;
      zone.y = prevY + actualDy;
    }
  }
  return { dx: actualDx, dy: actualDy };
}

function resolveAxis(entries, currentX, currentY, targetValue, axis) {
  let candidate = targetValue;
  let obstaclesMoved = false;
  const start = axis === 'x' ? currentX : currentY;
  const delta = candidate - start;
  if (Math.abs(delta) < COLLISION_EPSILON) {
    return { position: start, obstaclesMoved: false };
  }

  for (const entry of entries) {
    const obstacle = entry.obstacle;
    const metrics = obstacleMetrics(obstacle);
    const circleX = axis === 'x' ? candidate : currentX;
    const circleY = axis === 'y' ? candidate : currentY;
    if (!circleRectCollision(circleX, circleY, PLAYER_RADIUS, metrics)) {
      continue;
    }

    if (delta > 0) {
      const limitKey = axis === 'x' ? 'left' : 'top';
      let limit = metrics[limitKey] - PLAYER_RADIUS;
      if (candidate <= limit + COLLISION_EPSILON) {
        continue;
      }
      if (entry.pushable) {
        const desired = candidate - limit;
        const movement = tryMoveObstacle(
          entries,
          entry,
          axis === 'x' ? desired : 0,
          axis === 'y' ? desired : 0,
        );
        if (
          (axis === 'x' && Math.abs(movement.dx) > COLLISION_EPSILON) ||
          (axis === 'y' && Math.abs(movement.dy) > COLLISION_EPSILON)
        ) {
          obstaclesMoved = true;
        }
        const updated = obstacleMetrics(obstacle);
        limit = updated[limitKey] - PLAYER_RADIUS;
      }
      candidate = Math.min(candidate, limit);
    } else if (delta < 0) {
      const limitKey = axis === 'x' ? 'right' : 'bottom';
      let limit = metrics[limitKey] + PLAYER_RADIUS;
      if (candidate >= limit - COLLISION_EPSILON) {
        continue;
      }
      if (entry.pushable) {
        const desired = candidate - limit;
        const movement = tryMoveObstacle(
          entries,
          entry,
          axis === 'x' ? desired : 0,
          axis === 'y' ? desired : 0,
        );
        if (
          (axis === 'x' && Math.abs(movement.dx) > COLLISION_EPSILON) ||
          (axis === 'y' && Math.abs(movement.dy) > COLLISION_EPSILON)
        ) {
          obstaclesMoved = true;
        }
        const updated = obstacleMetrics(obstacle);
        limit = updated[limitKey] + PLAYER_RADIUS;
      }
      candidate = Math.max(candidate, limit);
    }
  }

  if (delta > 0) {
    candidate = Math.max(candidate, start);
  } else if (delta < 0) {
    candidate = Math.min(candidate, start);
  }

  if (axis === 'x') {
    candidate = clamp(candidate, PLAYER_RADIUS, PLAYFIELD_WIDTH - PLAYER_RADIUS);
  } else {
    candidate = clamp(candidate, PLAYER_RADIUS, PLAYFIELD_HEIGHT - PLAYER_RADIUS);
  }

  return { position: candidate, obstaclesMoved };
}

export function resolvePlayerMovement(state, player, targetX, targetY) {
  if (!state || !player) {
    return { moved: false, obstaclesMoved: false };
  }
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    return { moved: false, obstaclesMoved: false };
  }

  const config = state.config || {};
  const entries = obstacleEntries(config);

  const startX = Number(player.x) || 0;
  const startY = Number(player.y) || 0;

  const clampedX = clamp(targetX, PLAYER_RADIUS, PLAYFIELD_WIDTH - PLAYER_RADIUS);
  const clampedY = clamp(targetY, PLAYER_RADIUS, PLAYFIELD_HEIGHT - PLAYER_RADIUS);

  let resolvedX = clampedX;
  let resolvedY = clampedY;
  let obstaclesMoved = false;

  if (entries.length) {
    const adjusted = resolveCollisionOverlap(startX, startY, entries);
    const resultX = resolveAxis(entries, adjusted.x, adjusted.y, clampedX, 'x');
    resolvedX = resultX.position;
    obstaclesMoved = obstaclesMoved || resultX.obstaclesMoved;
    const resultY = resolveAxis(entries, resolvedX, adjusted.y, clampedY, 'y');
    resolvedY = resultY.position;
    obstaclesMoved = obstaclesMoved || resultY.obstaclesMoved;
  }

  const moved =
    Math.abs(resolvedX - startX) > COLLISION_EPSILON ||
    Math.abs(resolvedY - startY) > COLLISION_EPSILON;

  if (moved) {
    player.x = resolvedX;
    player.y = resolvedY;
    if (player.currentItem) {
      player.currentItem.x = resolvedX;
      player.currentItem.y = resolvedY;
    }
  }

  return { moved, obstaclesMoved };
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
    uuids: normalizeItemUuids(item.uuids),
  };
}

function normalizeItemUuids(raw) {
  if (typeof raw === 'string') {
    raw = [raw];
  }
  const result = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (result.includes(trimmed)) continue;
      result.push(trimmed);
    }
  }
  return result;
}

function generateItemUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `itm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    lastMoveSeq: Number(player.lastMoveSeq) || 0,
    lastActionSeq: Number(player.lastActionSeq) || 0,
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

function buildItemLookup(items) {
  const lookup = new Map();
  for (const item of items || []) {
    if (item && Number.isFinite(item.id)) {
      lookup.set(item.id, item);
    }
  }
  return lookup;
}

function cloneState(state) {
  if (!state) return null;
  const config = state.config ? { ...state.config } : {};
  const staticObstacles = Array.isArray(state.config?.staticObstacles)
    ? state.config.staticObstacles.map((ob) => ({ ...ob }))
    : [];
  const movingObstacles = Array.isArray(state.config?.movingObstacles)
    ? state.config.movingObstacles.map((ob) => ({ ...ob }))
    : [];
  config.staticObstacles = [...staticObstacles, ...movingObstacles];
  config.movingObstacles = [];
  const items = cloneItems(state.items);
  return {
    players: clonePlayers(state.players),
    items,
    orders: Array.isArray(state.orders) ? state.orders.map((o) => ({ ...o })) : [],
    score: Number(state.score) || 0,
    timer: Number(state.timer) || 0,
    gameOver: Boolean(state.gameOver),
    config,
    nextItemId: Number(state.nextItemId) || 1,
    resetScheduled: Boolean(state.resetScheduled),
    configRevision: Number(state.configRevision) || 0,
    hostId: state.hostId || '',
    clientManaged: Boolean(state.clientManaged),
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
    this.runtime = buildRuntimeMetadata({});
    this.configRevision = 0;
    this.itemLookup = new Map();
    this.uuidLookup = new Map();
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

  ensureItemLookup() {
    if (!(this.itemLookup instanceof Map)) {
      this.itemLookup = new Map();
    }
    return this.itemLookup;
  }

  ensureUuidLookup() {
    if (!(this.uuidLookup instanceof Map)) {
      this.uuidLookup = new Map();
    }
    return this.uuidLookup;
  }

  rebuildItemLookup() {
    this.itemLookup = buildItemLookup(this.state?.items);
    this.rebuildItemUuidLookup();
  }

  rebuildItemUuidLookup() {
    const lookup = this.ensureUuidLookup();
    lookup.clear();
    if (!this.state) {
      return;
    }
    Object.values(this.state.players || {}).forEach((player) => {
      if (player?.currentItem) {
        this.registerItemUuids(player.currentItem);
      }
    });
    (this.state.items || []).forEach((item) => {
      this.registerItemUuids(item);
    });
  }

  registerItemUuids(item) {
    if (!item) return true;
    item.uuids = normalizeItemUuids(item.uuids);
    if (!item.uuids.length) {
      return true;
    }
    const lookup = this.ensureUuidLookup();
    for (const [key, existing] of Array.from(lookup.entries())) {
      if (existing === item && !item.uuids.includes(key)) {
        lookup.delete(key);
      }
    }
    for (const uid of item.uuids) {
      const existing = lookup.get(uid);
      if (existing && existing !== item) {
        return false;
      }
    }
    for (const uid of item.uuids) {
      lookup.set(uid, item);
    }
    return true;
  }

  unregisterItemUuids(item) {
    if (!item) return;
    const lookup = this.ensureUuidLookup();
    for (const [key, existing] of Array.from(lookup.entries())) {
      if (existing === item) {
        lookup.delete(key);
      }
    }
  }

  isSettlementOpen(settlement) {
    if (!settlement || typeof settlement !== 'object') {
      return false;
    }
    const status = settlement.status;
    return status !== 'captured' && status !== 'voided';
  }

  restoreSourceItem(zone, task) {
    if (!this.state || !task) {
      return false;
    }
    const settlement = task.settlement || null;
    if (!this.isSettlementOpen(settlement)) {
      return false;
    }
    const source = task.source_item || null;
    if (!source) {
      return false;
    }
    const now = nowSeconds();
    const fallbackId = Number.isFinite(source.id) ? source.id : this.state.nextItemId;
    const restored = {
      id: fallbackId,
      type: source.type,
      state: source.state ?? 'raw',
      x: Number.isFinite(zone?.x) ? zone.x : Number(source.x) || 0,
      y: Number.isFinite(zone?.y) ? zone.y : Number(source.y) || 0,
      display: source.display || formatItemDisplay(source.type, source.state),
      uuids: normalizeItemUuids(source.uuids),
    };
    const worldItem = this.registerWorldItem(restored, false);
    if (worldItem) {
      if (settlement) {
        settlement.status = 'voided';
        settlement.closedAt = now;
        settlement.voidReason = 'cancelled';
        delete settlement.lastError;
        delete settlement.lastFailure;
      }
      this.dirty = true;
      return true;
    }
    if (settlement) {
      settlement.status = 'pending';
      settlement.lastError = 'uuid-conflict';
      settlement.lastFailure = now;
      this.dirty = true;
    }
    return false;
  }

  registerWorldItem(item, assignNewId = false) {
    if (!this.state) return null;
    const worldItem = {
      ...item,
      uuids: normalizeItemUuids(item?.uuids),
    };
    if (item) {
      this.unregisterItemUuids(item);
    }
    if (assignNewId || !Number.isFinite(worldItem.id)) {
      worldItem.id = this.state.nextItemId;
      this.state.nextItemId += 1;
    } else if (worldItem.id >= this.state.nextItemId) {
      this.state.nextItemId = worldItem.id + 1;
    }
    if (!this.registerItemUuids(worldItem)) {
      return null;
    }
    this.state.items.push(worldItem);
    this.ensureItemLookup().set(worldItem.id, worldItem);
    return worldItem;
  }

  removeWorldItem(target, options = {}) {
    if (!this.state) return null;
    const lookup = this.ensureItemLookup();
    const { clearCooking = false } = options;
    const itemId = typeof target === 'number' ? target : target?.id;
    if (!Number.isFinite(itemId)) {
      if (clearCooking) {
        this.clearCookingTaskForItem(itemId);
      }
      return null;
    }
    const existing = lookup.get(itemId);
    if (!existing) {
      if (clearCooking) {
        this.clearCookingTaskForItem(itemId);
      }
      return null;
    }
    lookup.delete(itemId);
    const index = this.state.items.findIndex((itm) => itm.id === itemId);
    if (index !== -1) {
      this.state.items.splice(index, 1);
    }
    if (clearCooking) {
      this.clearCookingTaskForItem(
        existing.id,
        existing.type,
        existing.state,
      );
    }
    return existing;
  }

  clearCookingTaskForItem(itemId, itemType = null, itemState = null) {
    if (!this.state?.config?.actionZones) {
      return false;
    }

    const matchesTask = (task) => {
      if (!task) return false;
      const rawId = task.result_item_id ?? task.resultItemId;
      const resultId = Number(rawId);
      if (Number.isFinite(itemId) && Number.isFinite(resultId) && resultId === itemId) {
        return true;
      }
      if (itemType && task.result_type === itemType) {
        const state = task.result_state ?? task.resultState;
        if (state == null || state === itemState) {
          const progress = Number(task.progress);
          if (!Number.isFinite(progress) || progress >= 1 || task.finishedAt) {
            return true;
          }
        }
      }
      return false;
    };

    let cleared = false;
    for (const [taskId, info] of Array.from(this.cookingTasks.entries())) {
      if (!info || !matchesTask(info.task)) {
        continue;
      }
      const zone = this.state.config.actionZones[info.zoneIndex];
      if (!zone) {
        this.cookingTasks.delete(taskId);
        continue;
      }
      delete zone.cooking;
      zone.occupied = false;
      this.cookingTasks.delete(taskId);
      cleared = true;
    }

    const zones = this.state.config.actionZones;
    if (!cleared) {
      for (let i = 0; i < zones.length; i += 1) {
        const zone = zones[i];
        if (!zone || !zone.cooking || !matchesTask(zone.cooking)) continue;
        const task = zone.cooking;
        delete zone.cooking;
        zone.occupied = false;
        if (task.id) {
          this.cookingTasks.delete(task.id);
        }
        cleared = true;
      }
    }

    if (cleared) {
      this.dirty = true;
    }
    return cleared;
  }

  clearWorldItems() {
    if (!this.state) return;
    this.state.items = [];
    this.ensureItemLookup().clear();
  }

  rebuildRuntime() {
    const cfg = this.state?.config || {};
    this.runtime = buildRuntimeMetadata(cfg);
    this.configRevision = Number(this.state?.configRevision) || 0;
    if (Array.isArray(this.state?.orders)) {
      this.state.orders = this.state.orders.map((order) => this.hydrateOrder({ ...order }));
    }
  }

  hydrateOrder(order) {
    if (!order) return order;
    hydrateOrderData(order, this.runtime, this.state?.config || {});
    return order;
  }

  loadState(state) {
    this.state = cloneState(state);
    this.timerAccumulator = 0;
    this.orderAccumulator = 0;
    this.cookingTasks.clear();
    this.rebuildItemLookup();
    if (!Array.isArray(this.state?.config?.staticObstacles)) {
      this.state.config.staticObstacles = [];
    }
    if (Array.isArray(this.state?.config?.movingObstacles) && this.state.config.movingObstacles.length) {
      this.state.config.staticObstacles.push(
        ...this.state.config.movingObstacles.map((ob) => ({ ...ob }))
      );
    }
    this.state.config.movingObstacles = [];
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
    this.rebuildRuntime();
    this.dirty = true;
  }

  mergeServerState(state, localPlayerId) {
    if (!this.state) {
      this.loadState(state);
      return;
    }
    let runtimeChanged = false;
    if (state?.config) {
      const incomingConfig = state.config || {};
      this.state.config = { ...incomingConfig };
      const staticObstacles = Array.isArray(incomingConfig.staticObstacles)
        ? incomingConfig.staticObstacles.map((ob) => ({ ...ob }))
        : [];
      const movingObstacles = Array.isArray(incomingConfig.movingObstacles)
        ? incomingConfig.movingObstacles.map((ob) => ({ ...ob }))
        : [];
      this.state.config.staticObstacles = [...staticObstacles, ...movingObstacles];
      this.state.config.movingObstacles = [];
      runtimeChanged = true;
    }
    if (Number.isFinite(state?.configRevision)) {
      const revision = Number(state.configRevision);
      if (revision !== this.configRevision) {
        runtimeChanged = true;
      }
      this.state.configRevision = revision;
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
        lastMoveSeq: Number(pdata?.lastMoveSeq) || 0,
        lastActionSeq: Number(pdata?.lastActionSeq) || 0,
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
      if (Number.isFinite(Number(pdata?.lastMoveSeq))) {
        const seq = Number(pdata.lastMoveSeq);
        if (seq >= 0) {
          player.lastMoveSeq = seq;
        }
      } else if (!Number.isFinite(Number(player.lastMoveSeq))) {
        player.lastMoveSeq = 0;
      }
      if (Number.isFinite(Number(pdata?.lastActionSeq))) {
        const actionSeq = Number(pdata.lastActionSeq);
        if (actionSeq >= 0) {
          player.lastActionSeq = actionSeq;
        }
      } else if (!Number.isFinite(Number(player.lastActionSeq))) {
        player.lastActionSeq = 0;
      }
      this.state.players[pid] = player;
    });
    Object.keys(this.state.players).forEach((pid) => {
      if (!(pid in incomingPlayers)) {
        delete this.state.players[pid];
        this.dirty = true;
      }
    });
    if (runtimeChanged) {
      this.rebuildRuntime();
    }
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
        lastMoveSeq: 0,
        lastActionSeq: 0,
      };
      this.dirty = true;
    }
    return this.state.players[playerId];
  }

  getPlayer(playerId) {
    if (!this.state) return null;
    return this.state.players[playerId] || null;
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
        this.clearWorldItems();
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
          this.hydrateOrder(updated);
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
    const zones = this.state?.config?.actionZones;
    if (!Array.isArray(zones) || !zones.length) return;

    const seedTime = nowSeconds();
    let normalised = false;
    for (let i = 0; i < zones.length; i += 1) {
      const zone = zones[i];
      if (!zone || !zone.cooking) continue;
      const task = zone.cooking;
      if (!task.id) {
        task.id = `task-${i}`;
        normalised = true;
      }
      if (!Number.isFinite(task.startedAt)) {
        task.startedAt = seedTime;
        normalised = true;
      }
      if (!Number.isFinite(task.progress)) {
        task.progress = 0;
        normalised = true;
      }
      if (!Number.isFinite(task.elapsed)) {
        task.elapsed = 0;
        normalised = true;
      }
      const duration = Math.max(Number(task.duration) || 0.1, 0.1);
      if (!Number.isFinite(task.remaining)) {
        task.remaining = duration;
        normalised = true;
      }

      if (!task.settlement || typeof task.settlement !== 'object') {
        const settlementId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `settle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        task.settlement = {
          id: settlementId,
          status: 'pending',
          createdAt: Number(task.startedAt) || seedTime,
          sourceItemId: task.source_item?.id ?? null,
        };
        normalised = true;
      } else {
        const settlement = task.settlement;
        if (!settlement.id) {
          settlement.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `settle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          normalised = true;
        }
        if (!settlement.status) {
          settlement.status = 'pending';
          normalised = true;
        }
        if (!Number.isFinite(settlement.createdAt)) {
          settlement.createdAt = Number(task.startedAt) || seedTime;
          normalised = true;
        }
        if (settlement.sourceItemId == null && task.source_item?.id != null) {
          settlement.sourceItemId = task.source_item.id;
          normalised = true;
        }
      }

      const id = task.id;
      const startedAt = Number(task.startedAt) || seedTime;
      const entry = this.cookingTasks.get(id);
      const rawResultId = Number(task.result_item_id ?? task.resultItemId);
      if (!entry) {
        const info = { zoneIndex: i, task, startedAt };
        if (Number.isFinite(rawResultId)) {
          info.resultItemId = rawResultId;
          info.spawnedAt = Number(task.finishedAt) || startedAt;
        }
        if (task.burned) {
          info.burned = true;
          info.burnDisplayAt = Number(task.burnedAt) || seedTime;
        }
        this.cookingTasks.set(id, info);
        normalised = true;
      } else {
        entry.zoneIndex = i;
        entry.task = task;
        if (!Number.isFinite(entry.startedAt) || Math.abs(entry.startedAt - startedAt) > 1e-3) {
          entry.startedAt = startedAt;
          normalised = true;
        }
        if (task.burned && !entry.burned) {
          entry.burned = true;
          entry.burnDisplayAt = Number(task.burnedAt) || seedTime;
          normalised = true;
        }
        if (Number.isFinite(rawResultId)) {
          if (entry.resultItemId !== rawResultId) {
            entry.resultItemId = rawResultId;
            normalised = true;
          }
          const spawnedAt = Number(task.finishedAt);
          if (Number.isFinite(spawnedAt)) {
            entry.spawnedAt = spawnedAt;
            normalised = true;
          } else if (!entry.spawnedAt) {
            entry.spawnedAt = entry.startedAt;
            normalised = true;
          }
        } else if (!Number.isFinite(rawResultId) && entry.resultItemId) {
          delete entry.resultItemId;
          delete entry.spawnedAt;
          normalised = true;
        }
      }
    }

    if (normalised) {
      this.dirty = true;
    }

    const now = nowSeconds();
    for (const [taskId, info] of Array.from(this.cookingTasks.entries())) {
      const zone = zones[info.zoneIndex];
      if (!zone || !zone.cooking || zone.cooking.id !== taskId) {
        if (info.task && this.isSettlementOpen(info.task.settlement)) {
          this.restoreSourceItem(zone, info.task);
        }
        if (zone && (!zone.cooking || zone.cooking.id === taskId)) {
          if (zone.occupied) {
            this.dirty = true;
          }
          delete zone.cooking;
          zone.occupied = false;
        }
        this.cookingTasks.delete(taskId);
        continue;
      }
      const task = zone.cooking;
      if (this.isSettlementOpen(task.settlement) && !zone.occupied) {
        zone.occupied = true;
        this.dirty = true;
      }
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

      const settlement = task.settlement || null;

      if (!info.resultItemId && progress >= 1) {
        if (settlement && settlement.status === 'settled') {
          const knownId = Number(settlement.resultItemId);
          if (Number.isFinite(knownId)) {
            info.resultItemId = knownId;
            task.result_item_id = knownId;
          }
        } else {
          const display = task.result_display || formatItemDisplay(task.result_type, task.result_state);
          const source = task.source_item || {};
          const candidate = {
            id: Number.isFinite(source.id) ? source.id : 0,
            type: task.result_type,
            x: zone.x,
            y: zone.y,
            state: task.result_state,
            display,
            uuids: normalizeItemUuids(source.uuids),
          };
          const worldItem = this.registerWorldItem(candidate, true);
          if (!worldItem) {
            if (settlement) {
              settlement.status = 'pending';
              settlement.lastError = 'uuid-conflict';
              settlement.lastFailure = now;
            }
            this.dirty = true;
            continue;
          }
          if (settlement) {
            settlement.status = 'settled';
            settlement.resultItemId = worldItem.id;
            settlement.settledAt = now;
            delete settlement.lastError;
            delete settlement.lastFailure;
          }
          task.displayText = display;
          task.result_item_id = worldItem.id;
          task.result_item_state = task.result_state;
          if (task.result_type && task.result_state != null) {
            task.texture = `${task.result_type}:${task.result_state}`;
          }
          task.finishedAt = now;
          info.resultItemId = worldItem.id;
          info.spawnedAt = now;
          this.dirty = true;
          continue;
        }
      }

      if (info.resultItemId && !info.burned) {
        const stillPresent = this.ensureItemLookup().has(info.resultItemId);
        if (!stillPresent) {
          delete zone.cooking;
          zone.occupied = false;
          this.cookingTasks.delete(taskId);
          if (settlement) {
            settlement.status = 'captured';
            settlement.closedAt = now;
          }
          this.dirty = true;
          continue;
        }
        const burnable = (
          task.result_type === 'ingredient_beef_patty' &&
          (task.result_state == null || task.result_state === 'cooked')
        );
        const burnLimit = burnable ? duration * 4 : 0;
        if (burnLimit > 0 && elapsed >= burnLimit) {
          const removed = this.removeWorldItem(info.resultItemId);
          if (!removed) {
            continue;
          }
          this.unregisterItemUuids(removed);
          task.displayText = '消し炭になってしまった！';
          task.progress = 0;
          task.remaining = 0;
          task.burned = true;
          info.burned = true;
          info.burnDisplayAt = now;
          if (settlement) {
            settlement.status = 'voided';
            settlement.closedAt = now;
          }
          this.dirty = true;
          continue;
        }
      }

      if (info.burned) {
        const shownFor = now - (info.burnDisplayAt || now);
        if (shownFor >= 1.5) {
          delete zone.cooking;
          zone.occupied = false;
          this.cookingTasks.delete(taskId);
          if (settlement && settlement.closedAt == null) {
            settlement.closedAt = now;
          }
          this.dirty = true;
        }
      }

      if (changed) {
        this.dirty = true;
      }
    }
  }

  handleMove(playerId, x, y) {
    if (!this.state) return false;
    const player = this.ensurePlayer(playerId);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const result = resolvePlayerMovement(this.state, player, x, y);
    if (result.moved || result.obstaclesMoved) {
      this.dirty = true;
    }
    return result.moved || result.obstaclesMoved;
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
    if (!this.state) return false;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const result = resolvePlayerMovement(this.state, player, x, y);
    if (result.moved || result.obstaclesMoved) {
      this.dirty = true;
    }
    return result.moved || result.obstaclesMoved;
  }

  pickupNearbyItem(player, x, y) {
    const radiusSq = 50 * 50;
    let candidate = null;
    for (const item of this.state.items) {
      if (distanceSquared(item.x, item.y, x, y) < radiusSq) {
        candidate = item;
        break;
      }
    }
    if (!candidate) {
      return false;
    }
    const removed = this.removeWorldItem(candidate, { clearCooking: true });
    if (!removed) {
      return false;
    }
    this.unregisterItemUuids(removed);
    const carried = {
      ...removed,
      uuids: normalizeItemUuids(removed.uuids),
    };
    if (!this.registerItemUuids(carried)) {
      return false;
    }
    player.currentItem = carried;
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
        uuids: [generateItemUuid()],
      };
      this.state.nextItemId += 1;
      if (!this.registerItemUuids(newItem)) {
        continue;
      }
      player.currentItem = newItem;
      generator.nextFood = randomChoice(choices) || wanted;
      return true;
    }
    return false;
  }

  resolveActionForItem(item) {
    if (!item) return null;
    const cfg = this.state.config || {};
    let recipe = findCookingRecipeFromLookup(this.runtime?.cookingLookup, item.type, item.state);
    if (!recipe) {
      const recipes = Array.isArray(cfg.cookingRecipes) && cfg.cookingRecipes.length
        ? cfg.cookingRecipes
        : COOKING_RECIPES;
      for (const candidate of recipes) {
        if (!candidate || candidate.type !== item.type) continue;
        const fromState = candidate.from;
        if (fromState && fromState !== item.state) {
          continue;
        }
        const action = candidate.action;
        const resultState = candidate.to ?? item.state;
        if (!action || resultState == null) {
          continue;
        }
        recipe = candidate;
        break;
      }
    }
    if (!recipe) return null;
    const action = recipe.action;
    const resultState = recipe.to ?? item.state;
    if (!action || resultState == null) {
      return null;
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

  startCooking(player, x, y) {
    const item = player.currentItem;
    const actionInfo = this.resolveActionForItem(item);
    if (!item || !actionInfo) return false;
    const zones = this.state.config?.actionZones || [];
    for (let i = 0; i < zones.length; i += 1) {
      const zone = zones[i];
      if (zone.action !== actionInfo.action) {
        continue;
      }
      if (zone.cooking && this.isSettlementOpen(zone.cooking.settlement)) {
        zone.occupied = true;
        continue;
      }
      if (zone.occupied) {
        continue;
      }
      if (!inZone(x, y, zone)) {
        continue;
      }
      zone.occupied = true;
      const sourceItem = cloneItem(item);
      this.unregisterItemUuids(item);
      player.currentItem = null;
      player.cooking = false;
      player.currentZone = null;
      player.image = player.base_image;
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `cook-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const textureKey = item.type && item.state ? `${item.type}:${item.state}` : item.type;
      const settlementId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `settle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const settlement = {
        id: settlementId,
        status: 'pending',
        createdAt: nowSeconds(),
        sourceItemId: sourceItem?.id ?? null,
      };
      const task = {
        id,
        progress: 0,
        duration: Math.max(actionInfo.duration, 0.1),
        texture: textureKey,
        itemType: item.type,
        item_state: item.state,
        displayText:
          actionInfo.display ||
          zone.display ||
          (actionInfo.action === 'cut' ? '切っている…' : '焼いている…'),
        result_type: actionInfo.resultType,
        result_state: actionInfo.resultState,
        result_display: formatItemDisplay(actionInfo.resultType, actionInfo.resultState),
        startedAt: nowSeconds(),
        source_item: sourceItem,
        settlement,
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
    this.unregisterItemUuids(item);
    player.currentItem = null;
    return true;
  }

  dropItem(player, x, y) {
    const item = player.currentItem;
    if (!item) return;
    item.x = x;
    item.y = y;
    item.display = formatItemDisplay(item.type, item.state);
    const itemId = Number.isFinite(item.id) ? item.id : null;
    const itemType = item.type || null;
    const itemState = item.state || null;
    this.clearCookingTaskForItem(itemId, itemType, itemState);
    const recipes = Array.isArray(this.state?.config?.combinationRecipes)
      && this.state.config.combinationRecipes.length
      ? this.state.config.combinationRecipes
      : COMBINATION_RECIPES;
    const overlapTolerance = PLAYER_RADIUS + 8;
    for (const other of this.state.items) {
      if (!other) continue;
      if (Math.abs(other.x - item.x) > overlapTolerance || Math.abs(other.y - item.y) > overlapTolerance) {
        continue;
      }
      let recipe = findCombinationFromIndex(
        this.runtime?.combinationIndex,
        item.type,
        item.state,
        other.type,
        other.state,
      );
      if (!recipe) {
        recipe = findCombinationRecipe(recipes, item.type, item.state, other.type, other.state);
      }
      if (!recipe) {
        continue;
      }
      const result = recipe.result || {};
      const resultType = result.type;
      if (!resultType) {
        continue;
      }
      const resultState = result.state || defaultItemState(resultType);
      const otherId = Number.isFinite(other.id) ? other.id : null;
      const otherType = other.type || null;
      const otherState = other.state || null;
      this.clearCookingTaskForItem(otherId, otherType, otherState);
      this.clearCookingTaskForItem(itemId, itemType, itemState);
      const mergedUuids = normalizeItemUuids([
        ...(other.uuids || []),
        ...(item.uuids || []),
      ]);
      this.unregisterItemUuids(item);
      other.uuids = mergedUuids;
      this.registerItemUuids(other);
      other.type = resultType;
      other.state = resultState;
      other.display = formatItemDisplay(resultType, resultState);
      player.currentItem = null;
      return;
    }
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
    const worldItem = this.registerWorldItem(item, true);
    if (!worldItem) {
      this.registerItemUuids(item);
      return;
    }
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
    }
    return this.hydrateOrder(order);
  }

  resolveOrderItemType(dish) {
    if (!dish) return null;
    if (this.runtime?.orderLookup?.has(dish)) {
      return this.runtime.orderLookup.get(dish);
    }
    const mapping = this.state.config?.orderMapping || {};
    return Object.entries(mapping).find(([, value]) => value === dish)?.[0] || null;
  }

  resolveItemImage(itemType, state) {
    return resolveItemImageFromConfig(this.state?.config, itemType, state, this.runtime?.customItemMap);
  }
}
