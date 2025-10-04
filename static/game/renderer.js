export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  render(state, playerId) {
    this.clear();
    this.renderBackground();
    if (!state) return;

    this.renderStaticObstacles(state.config?.staticObstacles || []);
    this.renderMovingObstacles(state.config?.movingObstacles || []);
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
    const left = zone.x - zone.width / 2 + padding;
    const top = zone.y - zone.height / 2 + padding;
    const width = zone.width - padding * 2;
    const height = zone.height - padding * 2;

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
      zone.x - zone.width / 2,
      zone.y - zone.height / 2,
      zone.width,
      zone.height
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
      zone.x - zone.width / 2,
      zone.y - zone.height / 2,
      zone.width,
      zone.height
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
      this.ctx.moveTo(src.x, src.y);
      this.ctx.lineTo(dst.x, dst.y);
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
      }
      const stroke = zone.occupied ? '#ff7043' : '#4dd0e1';
      this.strokeZone(zone, { color: stroke, width: 2 });
    });
  }

  renderDeliveryZone(zone) {
    if (!zone) return;
    const drawn = this.drawZoneTexture(zone, zone.texture || 'delivery_zone');
    if (!drawn) {
      this.fillZone(zone, 'rgba(255, 202, 64, 0.28)');
    }
    this.strokeZone(zone, { color: '#ffca28', dash: [8, 4], width: 3 });
  }

  renderFoodGenerators(generators) {
    generators.forEach((fg) => {
      const drawn = this.drawZoneTexture(fg, fg.texture || 'food_generator');
      if (!drawn) {
        this.fillZone(fg, 'rgba(129, 199, 132, 0.35)');
      }
      this.strokeZone(fg, { color: '#66bb6a', width: 2 });

      const img = this.assets.get(fg.nextFood);
      if (img && img.complete && img.naturalWidth > 0) {
        const size = Math.min(fg.width, fg.height, 64);
        this.ctx.drawImage(img, fg.x - size / 2, fg.y - size / 2, size, size);
      } else {
        this.drawPlaceholderCircle(
          fg.x,
          fg.y,
          Math.min(fg.width, fg.height, 60) / 2,
          '#66bb6a'
        );
      }
    });
  }

  renderStaticObstacles(obstacles) {
    obstacles.forEach((ob) => {
      const drawn = this.drawZoneTexture(ob, ob.texture || 'static_obstacle');
      if (!drawn) {
        this.fillZone(ob, 'rgba(120, 144, 156, 0.5)');
      }
      this.strokeZone(ob, { color: 'rgba(55, 71, 79, 0.6)', width: 2 });
    });
  }

  renderMovingObstacles(obstacles) {
    obstacles.forEach((ob) => {
      const drawn = this.drawZoneTexture(ob, ob.texture || 'moving_obstacle');
      if (!drawn) {
        this.fillZone(ob, 'rgba(38, 166, 154, 0.45)');
      }
      this.strokeZone(ob, { color: 'rgba(0, 150, 136, 0.75)', width: 2 });
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
        }
        this.strokeZone(tr.sourceZone, {
          color: 'rgba(77, 208, 225, 0.9)',
          dash: [10, 6],
          width: 2,
        });
      }
      if (tr.destination) {
        const drawn = this.drawZoneTexture(
          tr.destination,
          tr.destination.texture || 'transferDst'
        );
        if (!drawn) {
          this.fillZone(tr.destination, 'rgba(3, 169, 244, 0.35)');
        }
        this.strokeZone(tr.destination, {
          color: 'rgba(3, 169, 244, 0.9)',
          dash: [10, 6],
          width: 2,
        });
      }
    });
  }

  renderItems(items) {
    items.forEach((item) => {
      const size = 72;
      const img = this.assets.get(item.type);
      if (img && img.complete && img.naturalWidth > 0) {
        this.ctx.drawImage(img, item.x - size / 2, item.y - size / 2, size, size);
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
      const size = isSelf ? 80 : 70;
      const imgKey = player.image || 'player1';
      const img = this.assets.get(imgKey);
      const px = player.x;
      const py = player.y;
      if (img && img.complete && img.naturalWidth > 0) {
        this.ctx.drawImage(img, px - size / 2, py - size / 2, size, size);
      } else {
        this.drawPlaceholderCircle(px, py, size / 2, isSelf ? '#29b6f6' : '#90a4ae');
      }

      if (player.currentItem) {
        const itemImg = this.assets.get(player.currentItem.type);
        const itemSize = 48;
        if (itemImg && itemImg.complete && itemImg.naturalWidth > 0) {
          this.ctx.drawImage(
            itemImg,
            px - itemSize / 2,
            py - size / 2 - itemSize,
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
      const textureKey = data.texture || data.itemType || data.result_type;
      if (textureKey) {
        const img = this.assets.get(textureKey);
        const size = Math.min(96, zone.width * 0.8, zone.height * 0.8);
        if (img && img.complete && img.naturalWidth > 0) {
          this.ctx.drawImage(img, zone.x - size / 2, zone.y - size / 2, size, size);
        } else {
          this.drawPlaceholderCircle(zone.x, zone.y, size / 2, '#ffe082');
        }
      }

      const label = data.displayText || '調理中…';
      this.drawLabel(label, zone.x, zone.y - zone.height / 2 - 10);

      const barWidth = Math.min(zone.width * 0.8, 180);
      const barHeight = 12;
      const barX = zone.x - barWidth / 2;
      const barY = zone.y + zone.height / 2 + 12;
      const progress = Math.max(0, Math.min(data.progress ?? 0, 1));

      this.ctx.save();
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      this.ctx.fillRect(barX, barY, barWidth, barHeight);
      let color = '#4caf50';
      if (progress < 0.34) color = '#ef5350';
      else if (progress < 0.67) color = '#ffb74d';
      this.ctx.fillStyle = color;
      this.ctx.fillRect(barX + 2, barY + 2, (barWidth - 4) * progress, barHeight - 4);
      this.ctx.restore();
    });
  }

  drawPlaceholderCircle(x, y, radius, color) {
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
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
    this.ctx.strokeText(text, x, y);
    this.ctx.fillText(text, x, y);
    this.ctx.restore();
  }
}
