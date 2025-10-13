const newItemPath = (filename) => `/static/new_items/${encodeURIComponent(filename)}`;

const INGREDIENT_FILE_OVERRIDES = {
  ingredient_tomato: 'TMT.png',
};

const STATE_TEXTURE_OVERRIDES = {
  'ingredient_burger_buns:raw': 'burger_buns.png',
  'ingredient_burger_buns:toasted': 'burger_buns.png',
  'ingredient_beef_patty:raw': 'beef_patty.png',
  'ingredient_beef_patty:cooked': 'grilled_beef_patty.png',
  'ingredient_lettuce:raw': 'lettuce.png',
  'ingredient_lettuce:chopped': 'lettuce_cut.png',
  'ingredient_tomato:raw': 'TMT.png',
  'ingredient_tomato:chopped': 'TMT_slice.png',
};

const STATIC_TEXTURE_OVERRIDES = {
  background: newItemPath('背景 コンクリート_ブラッシュアップ1.png'),
  action_default: newItemPath('まな板が乗っているカウンター.png'),
  action_cut: newItemPath('まな板が乗っているカウンター.png'),
  action_mix: newItemPath('まな板が乗っているカウンター.png'),
  action_bake: newItemPath('フライパンが乗っているカウンター.png'),
  action_fry: newItemPath('フライパンが乗っているカウンター.png'),
  action_grill: newItemPath('フライパンが乗っているカウンター.png'),
  action_boil: newItemPath('フライパンが乗っているカウンター.png'),
  delivery_zone: newItemPath('配膳用カウンター.png'),
  delivery: newItemPath('配膳用カウンター.png'),
  food_generator: newItemPath('食材が出てくるかご.png'),
  foodGen: newItemPath('食材が出てくるかご.png'),
  moving_obstacle: newItemPath('四角いカウンター .png'),
  static_obstacle: newItemPath('四角いカウンター .png'),
  sourceImage: newItemPath('食材ワープ(青).png'),
  destinationImage: newItemPath('食材ワープ(紫).png'),
  transferSrc: newItemPath('食材ワープ(青).png'),
  transferDst: newItemPath('食材ワープ(紫).png'),
};

export class AssetCache {
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

    if (
      key.startsWith('http://') ||
      key.startsWith('https://') ||
      key.startsWith('/')
    ) {
      return key;
    }

    if (STATE_TEXTURE_OVERRIDES[key]) {
      return newItemPath(STATE_TEXTURE_OVERRIDES[key]);
    }

    if (STATIC_TEXTURE_OVERRIDES[key]) {
      return STATIC_TEXTURE_OVERRIDES[key];
    }

    if (key.startsWith('ingredient_')) {
      const override = INGREDIENT_FILE_OVERRIDES[key];
      if (override) {
        return newItemPath(override);
      }
      return newItemPath(`${key.replace('ingredient_', '')}.png`);
    }

    if (key.includes(':')) {
      const base = key.split(':', 1)[0];
      return this.resolvePath(base);
    }

    if (key.startsWith('dish_')) {
      return '/static/new_items/hamburger.png';
    }

    if (key.startsWith('player')) {
      return `/static/assets/player/${key}.png`;
    }

    if (key.startsWith('obstacle')) {
      return `/static/assets/obstacle/${key}.png`;
    }

    const fallback = newItemPath(`${key}.png`);
    if (this.errorTokens.has(fallback)) {
      return `/static/assets/${key}.png`;
    }
    return fallback;
  }
}
