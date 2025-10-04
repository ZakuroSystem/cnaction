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
      delivery_zone: '/static/assets/delivery_zone.png',
      food_generator: '/static/assets/food_generator.png',
      sourceImage: '/static/assets/sourceImage.png',
      destinationImage: '/static/assets/destinationImage.png',
    };

    if (table[key]) {
      return table[key];
    }

    return `/static/assets/${key}.png`;
  }
}
