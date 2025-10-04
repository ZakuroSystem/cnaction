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

    if (key.startsWith('ingredient_')) {
      return `/static/assets/ingredient/${key.replace('ingredient_', '')}.png`;
    }

    if (key.startsWith('player')) {
      return `/static/assets/player/${key}.png`;
    }

    if (key.startsWith('obstacle')) {
      return `/static/assets/obstacle/${key}.png`;
    }

    const table = {
      background: '/static/assets/background/kitchen.png',
      action_default: '/static/assets/cooking_zone1.png',
      action_cut: '/static/assets/cooking_zone1.png',
      action_mix: '/static/assets/cooking_zone1.png',
      action_bake: '/static/assets/cooking_zone2.png',
      action_fry: '/static/assets/cooking_zone2.png',
      action_grill: '/static/assets/cooking_zone2.png',
      action_boil: '/static/assets/cooking_zone2.png',
      delivery_zone: '/static/assets/delivery_zone.png',
      delivery: '/static/assets/delivery_zone.png',
      food_generator: '/static/assets/food_generator.png',
      foodGen: '/static/assets/food_generator.png',
      moving_obstacle: '/static/assets/obstacle/obstacle2.png',
      static_obstacle: '/static/assets/obstacle/obstacle1.png',
      sourceImage: '/static/assets/sourceImage.png',
      destinationImage: '/static/assets/destinationImage.png',
      transferSrc: '/static/assets/sourceImage.png',
      transferDst: '/static/assets/destinationImage.png',
    };

    if (table[key]) {
      return table[key];
    }

    return `/static/assets/${key}.png`;
  }
}
