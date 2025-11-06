import { PLAYER_RADIUS } from './local-simulator.js';

const SPRITE_BASE_SIZE = PLAYER_RADIUS * 2;
const HELD_ITEM_SIZE = Math.round(SPRITE_BASE_SIZE * 0.75);
const snap = (value) => Math.round(value);
const snapSize = (value) => Math.max(1, Math.round(value));

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.ctx.imageSmoothingEnabled = false;
    if (this.canvas && this.canvas.style) {
      this.canvas.style.imageRendering = 'pixelated';
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(state, playerId) {
    this.ctx.imageSmoothingEnabled = false;
    this.clear();
    this.renderBackground();
    if (!state) return;

    const staticObstacles = Array.isArray(state.config?.staticObstacles)
      ? state.config.staticObstacles
      : [];
    const migrated = Array.isArray(state.config?.movingObstacles)
      ? state.config.movingObstacles
      : [];
    this.renderStaticObstacles([...staticObstacles, ...migrated]);
    this.renderFoodGenerators(state.config?.foodGenerators || []);
    this.renderTransferPads(state.config?.transferObjects || []);
    this.renderActionZones(state.config?.actionZones || []);
    this.renderDeliveryZone(state.config?.deliveryZone);
    this.renderTransfers(state.config?.transferObjects || []);
    this.renderItems(state.items || []);
    this.renderPlayers(state.players || {}, playerId);
    this.renderCookingOverlays(state.config?.actionZones || []);
  }

  renderBackground() {
    const bg = this.assets.get('background');
    if (bg && bg.complete && bg.naturalWidth > 0) {
      this.ctx.drawImage(bg, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx.fillStyle = '#263238';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  textureForAction(action) {
    switch (action) {
      case 'cut':
        return 'action_cut';
      case 'mix':
        return 'action_mix';
      case 'bake':
      case 'fry':
      case 'grill':
      case 'boil':
        return 'action_bake';
      default:
        return 'action_default';
    }
  }

  drawZoneTexture(zone, textureKey, options = {}) {
    if (!zone || !textureKey) return false;
    const img = this.assets.get(textureKey);
    if (!img || !img.complete || img.naturalWidth === 0) {
      return false;
    }

    const padding = options.padding || 0;
    const alpha = options.alpha ?? 1;
    const left = snap(zone.x - zone.width / 2 + padding);
    const top = snap(zone.y - zone.height / 2 + padding);
    const width = snapSize(zone.width - padding * 2);
    const height = snapSize(zone.height - padding * 2);

    if (width <= 0 || height <= 0) {
      return false;
    }

    this.ctx.save();
    if (alpha < 1) {
      this.ctx.globalAlpha = alpha;
    }
    this.ctx.drawImage(img, left, top, width, height);
    this.ctx.restore();
    return true;
  }

  fillZone(zone, color) {
    if (!zone) return;
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      snap(zone.x - zone.width / 2),
      snap(zone.y - zone.height / 2),
      snapSize(zone.width),
      snapSize(zone.height)
    );
    this.ctx.restore();
  }

  strokeZone(zone, { color = '#ffffff', dash = null, width = 2 } = {}) {
    if (!zone) return;
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    if (dash && Array.isArray(dash)) {
      this.ctx.setLineDash(dash);
    }
    this.ctx.strokeRect(
      snap(zone.x - zone.width / 2),
      snap(zone.y - zone.height / 2),
      snapSize(zone.width),
      snapSize(zone.height)
    );
    this.ctx.restore();
  }

  renderTransfers(transfers) {
    transfers.forEach((tr) => {
      const src = tr.sourceZone;
      const dst = tr.destination;
      if (!src || !dst) return;
      this.ctx.save();
      this.ctx.setLineDash([6, 6]);
      this.ctx.strokeStyle = '#4dd0e1';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(snap(src.x), snap(src.y));
      this.ctx.lineTo(snap(dst.x), snap(dst.y));
      this.ctx.stroke();
      this.ctx.restore();
    });
  }

  renderActionZones(zones) {
    zones.forEach((zone) => {
      const textureKey = zone.texture || this.textureForAction(zone.action);
      const drawn = this.drawZoneTexture(zone, textureKey);
      if (!drawn) {
        const fill =
          zone.action === 'bake'
            ? 'rgba(255, 183, 77, 0.35)'
            : 'rgba(129, 212, 250, 0.35)';
        this.fillZone(zone, fill);
        const stroke = zone.occupied ? '#ff7043' : '#4dd0e1';
        this.strokeZone(zone, { color: stroke, width: 2 });
      } else if (zone.occupied) {
        this.overlayZone(zone, 'rgba(255, 112, 67, 0.35)');
      }
    });
  }

  renderDeliveryZone(zone) {
    if (!zone) return;
    const drawn = this.drawZoneTexture(zone, zone.texture || 'delivery_zone');
    if (!drawn) {
      this.fillZone(zone, 'rgba(255, 202, 64, 0.28)');
      this.strokeZone(zone, { color: '#ffca28', dash: [8, 4], width: 3 });
    }
  }

  renderFoodGenerators(generators) {
    generators.forEach((fg) => {
      const drawn = this.drawZoneTexture(fg, fg.texture || 'food_generator');
      if (!drawn) {
        this.fillZone(fg, 'rgba(129, 199, 132, 0.35)');
        this.strokeZone(fg, { color: '#66bb6a', width: 2 });
      }

      const img = this.assets.get(fg.nextFood);
      if (img && img.complete && img.naturalWidth > 0) {
        const baseSize = Math.min(SPRITE_BASE_SIZE, fg.width, fg.height);
        const size = snapSize(baseSize);
        const left = snap(fg.x - size / 2);
        const top = snap(fg.y - size / 2);
        this.ctx.drawImage(img, left, top, size, size);
      } else {
        const radius = snapSize(Math.min(fg.width, fg.height, SPRITE_BASE_SIZE) / 2);
        this.drawPlaceholderCircle(fg.x, fg.y, radius, '#66bb6a');
      }
    });
  }

  renderStaticObstacles(obstacles) {
    obstacles.forEach((ob) => {
      const drawn = this.drawZoneTexture(ob, ob.texture || 'static_obstacle');
      if (!drawn) {
        this.fillZone(ob, 'rgba(120, 144, 156, 0.5)');
        this.strokeZone(ob, { color: 'rgba(55, 71, 79, 0.6)', width: 2 });
      }
    });
  }

  renderTransferPads(transfers) {
    transfers.forEach((tr) => {
      if (!tr) return;
      if (tr.sourceZone) {
        const drawn = this.drawZoneTexture(
          tr.sourceZone,
          tr.sourceZone.texture || 'transferSrc'
        );
        if (!drawn) {
          this.fillZone(tr.sourceZone, 'rgba(77, 208, 225, 0.35)');
          this.strokeZone(tr.sourceZone, {
            color: 'rgba(77, 208, 225, 0.9)',
            dash: [10, 6],
            width: 2,
          });
        }
      }
      if (tr.destination) {
        const drawn = this.drawZoneTexture(
          tr.destination,
          tr.destination.texture || 'transferDst'
        );
        if (!drawn) {
          this.fillZone(tr.destination, 'rgba(3, 169, 244, 0.35)');
          this.strokeZone(tr.destination, {
            color: 'rgba(3, 169, 244, 0.9)',
            dash: [10, 6],
            width: 2,
          });
        }
      }
    });
  }

  overlayZone(zone, color) {
    if (!zone) return;
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      snap(zone.x - zone.width / 2),
      snap(zone.y - zone.height / 2),
      snapSize(zone.width),
      snapSize(zone.height)
    );
    this.ctx.restore();
  }

  renderItems(items) {
    items.forEach((item) => {
      const size = snapSize(SPRITE_BASE_SIZE);
      const textureKey = this.textureKeyForItem(item);
      const img = this.assets.get(textureKey);
      if (img && img.complete && img.naturalWidth > 0) {
        const left = snap(item.x - size / 2);
        const top = snap(item.y - size / 2);
        this.ctx.drawImage(img, left, top, size, size);
      } else {
        this.drawPlaceholderCircle(item.x, item.y, size / 2, '#ffab91');
      }
      if (item.display) {
        this.drawLabel(item.display, item.x, item.y + size / 2 + 16);
      }
    });
  }

  renderPlayers(players, playerId) {
    Object.entries(players).forEach(([pid, player]) => {
      const isSelf = pid === playerId;
      const size = snapSize(SPRITE_BASE_SIZE);
      const imgKey = player.image || 'player1';
      const img = this.assets.get(imgKey);
      const px = snap(player.x);
      const py = snap(player.y);
      if (img && img.complete && img.naturalWidth > 0) {
        const left = snap(px - size / 2);
        const top = snap(py - size / 2);
        this.ctx.drawImage(img, left, top, size, size);
      } else {
        this.drawPlaceholderCircle(px, py, size / 2, isSelf ? '#29b6f6' : '#90a4ae');
      }

      if (player.currentItem) {
        const textureKey = this.textureKeyForItem(player.currentItem);
        const itemImg = this.assets.get(textureKey);
        const itemSize = snapSize(HELD_ITEM_SIZE);
        if (itemImg && itemImg.complete && itemImg.naturalWidth > 0) {
          const heldLeft = snap(px - itemSize / 2);
          const heldTop = snap(py - size / 2 - itemSize);
          this.ctx.drawImage(
            itemImg,
            heldLeft,
            heldTop,
            itemSize,
            itemSize
          );
        } else {
          this.drawPlaceholderCircle(
            px,
            py - size / 2 - itemSize / 2,
            itemSize / 2,
            '#ffcc80'
          );
        }
      }
    });
  }

  renderCookingOverlays(zones) {
    zones.forEach((zone) => {
      if (!zone.cooking) return;
      const data = zone.cooking;
      const textureKey =
        data.texture ||
        (data.itemType && data.item_state ? `${data.itemType}:${data.item_state}` : data.itemType) ||
        (data.result_type && data.result_state ? `${data.result_type}:${data.result_state}` : data.result_type);
      if (textureKey) {
        const img = this.assets.get(textureKey);
        const baseSize = Math.min(SPRITE_BASE_SIZE, zone.width * 0.8, zone.height * 0.8);
        const size = snapSize(baseSize);
        if (img && img.complete && img.naturalWidth > 0) {
          const left = snap(zone.x - size / 2);
          const top = snap(zone.y - size / 2);
          this.ctx.drawImage(img, left, top, size, size);
        } else {
          this.drawPlaceholderCircle(zone.x, zone.y, size / 2, '#ffe082');
        }
      }

      const label = data.displayText || '調理中…';
      this.drawLabel(label, zone.x, zone.y - zone.height / 2 - 10);

      const barWidth = snapSize(Math.min(zone.width * 0.8, 180));
      const barHeight = snapSize(12);
      const barX = snap(zone.x - barWidth / 2);
      const barY = snap(zone.y + zone.height / 2 + 12);
      const progress = Math.max(0, Math.min(data.progress ?? 0, 1));

      this.ctx.save();
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      this.ctx.fillRect(barX, barY, barWidth, barHeight);
      let color = '#4caf50';
      if (progress < 0.34) color = '#ef5350';
      else if (progress < 0.67) color = '#ffb74d';
      this.ctx.fillStyle = color;
      const rawInner = (barWidth - 4) * progress;
      const innerWidth = rawInner <= 0 ? 0 : Math.min(barWidth - 4, Math.max(1, Math.round(rawInner)));
      if (innerWidth > 0) {
        this.ctx.fillRect(barX + 2, barY + 2, innerWidth, barHeight - 4);
      }
      this.ctx.restore();
    });
  }

  textureKeyForItem(item) {
    if (!item) return null;
    if (item.texture) return item.texture;
    const type = item.type;
    const state = item.state;
    if (type && state) {
      return `${type}:${state}`;
    }
    return type;
  }

  drawPlaceholderCircle(x, y, radius, color) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(snap(x), snap(y), snapSize(radius), 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  drawLabel(text, x, y) {
    this.ctx.save();
    this.ctx.font = '16px "Noto Sans JP", sans-serif';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    this.ctx.lineWidth = 4;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    const px = snap(x);
    const py = snap(y);
    this.ctx.strokeText(text, px, py);
    this.ctx.fillText(text, px, py);
    this.ctx.restore();
  }
}
