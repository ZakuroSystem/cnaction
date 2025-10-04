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

    this.renderTransfers(state.config?.transferObjects || []);
    this.renderActionZones(state.config?.actionZones || []);
    this.renderDeliveryZone(state.config?.deliveryZone);
    this.renderFoodGenerators(state.config?.foodGenerators || []);
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

  renderTransfers(transfers) {
    transfers.forEach((tr) => {
      const src = tr.sourceZone;
      const dst = tr.destination;
      if (!src || !dst) return;
      this.ctx.save();
      this.ctx.setLineDash([6, 6]);
      this.ctx.strokeStyle = '#4dd0e1';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(
        src.x - src.width / 2,
        src.y - src.height / 2,
        src.width,
        src.height
      );
      this.ctx.strokeRect(
        dst.x - dst.width / 2,
        dst.y - dst.height / 2,
        dst.width,
        dst.height
      );
      this.ctx.restore();
    });
  }

  renderActionZones(zones) {
    zones.forEach((zone) => {
      this.ctx.save();
      const fill =
        zone.action === 'bake'
          ? 'rgba(255, 183, 77, 0.35)'
          : 'rgba(129, 212, 250, 0.35)';
      const stroke = zone.occupied ? '#ff7043' : '#4dd0e1';
      this.ctx.fillStyle = fill;
      this.ctx.strokeStyle = stroke;
      this.ctx.lineWidth = 2;
      this.ctx.fillRect(
        zone.x - zone.width / 2,
        zone.y - zone.height / 2,
        zone.width,
        zone.height
      );
      this.ctx.strokeRect(
        zone.x - zone.width / 2,
        zone.y - zone.height / 2,
        zone.width,
        zone.height
      );
      this.ctx.restore();
    });
  }

  renderDeliveryZone(zone) {
    if (!zone) return;
    this.ctx.save();
    this.ctx.strokeStyle = '#ffca28';
    this.ctx.setLineDash([8, 4]);
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(
      zone.x - zone.width / 2,
      zone.y - zone.height / 2,
      zone.width,
      zone.height
    );
    this.ctx.restore();
  }

  renderFoodGenerators(generators) {
    generators.forEach((fg) => {
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(129, 199, 132, 0.35)';
      this.ctx.strokeStyle = '#66bb6a';
      this.ctx.lineWidth = 2;
      this.ctx.fillRect(
        fg.x - fg.width / 2,
        fg.y - fg.height / 2,
        fg.width,
        fg.height
      );
      this.ctx.strokeRect(
        fg.x - fg.width / 2,
        fg.y - fg.height / 2,
        fg.width,
        fg.height
      );
      this.ctx.restore();

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
