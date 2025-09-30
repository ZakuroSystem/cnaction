const socket = io();

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    this.serverState = null;
    this.otherPlayers = {};
    this.movingObsInitialized = false;
    this.transferGroup = null;
    this.itemOverlay = {}; // 各プレイヤーのアイテムオーバーレイ管理
    this.orderListEl = null;
  }
  
  preload() {
    // すべてのパスは先頭に "/static/" を付与
    this.load.image('background', '/static/assets/background/kitchen.png');
    
    // 基本のプレイヤー画像（最大4人分）と各調理状態用の画像を事前にキャッシュ
    for (let i = 1; i <= 4; i++) {
      this.load.image('player' + i, '/static/assets/player/player' + i + '.png');
      this.load.image('player' + i + '_knife', '/static/assets/player/player' + i + '_knife.png');
      this.load.image('player' + i + '_frying_pan', '/static/assets/player/player' + i + '_frying_pan.png');
    }
    // 念のためデフォルト用
    this.load.image('player', '/static/assets/player/player1.png');
    
    // その他の画像
    this.load.image('ingredient_tomato', '/static/assets/ingredient/tomato.png');
    this.load.image('ingredient_lettuce', '/static/assets/ingredient/lettuce.png');
    this.load.image('ingredient_bread', '/static/assets/ingredient/bread.png');
    this.load.image('obstacle1', '/static/assets/obstacle/obstacle1.png');
    this.load.image('obstacle2', '/static/assets/obstacle/obstacle2.png');
    this.load.image('cooking_zone1', '/static/assets/cooking_zone1.png');
    this.load.image('cooking_zone2', '/static/assets/cooking_zone2.png');
    this.load.image('delivery_zone', '/static/assets/delivery_zone.png');
    this.load.image('food_generator', '/static/assets/food_generator.png');
    this.load.image('sourceImage', '/static/assets/sourceImage.png');
    this.load.image('destinationImage', '/static/assets/destinationImage.png');
  }
  
  create() {
    this.add.image(400, 300, 'background').setDepth(-1);
    this.playerSprite = this.physics.add.sprite(100, 100, 'player1').setDisplaySize(96, 96);
    this.playerSprite.setCollideWorldBounds(true);
    this.playerSprite.setDepth(100);
  
    this.itemGroup = this.add.group();
    this.staticObsGroup = this.physics.add.staticGroup();
    this.movingObsGroup = this.add.group();
    this.transferGroup = this.add.group();

    // 調理場（アクションゾーン）をまとめるグループ
    this.actionZoneGroup = this.add.group();
    // 配膳エリアは1つのみ想定
    this.deliveryZoneImage = this.add.image(700, 500, 'delivery_zone').setDisplaySize(150, 150);
  
    this.foodGenImages = [];
    this.foodPreviewImages = [];
    if (window.config.foodGenerators) {
      window.config.foodGenerators.forEach(fg => {
        let img = this.add.image(fg.x, fg.y, 'food_generator').setDisplaySize(fg.width, fg.height);
        this.foodGenImages.push(img);
        let preview = this.add.image(fg.x, fg.y, fg.nextFood).setDisplaySize(48, 48);
        this.foodPreviewImages.push(preview);
      });
    }
  
    this.orderListEl = document.getElementById('order-list');
    // 新規追加: タイマー表示用テキスト（画面右下、原点を右下に合わせる）
    this.timerText = this.add.text(790, 590, '', {
      font: '24px Arial',
      fill: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      padding: { x: 10, y: 10 }
    }).setOrigin(1, 1).setDepth(9999);;
    this.scoreText = this.add.text(790, 10, '', {
      font: '24px Arial',
      fill: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      padding: { x: 10, y: 10 }
    }).setOrigin(1, 0).setDepth(9999);;
    this.inventoryText = this.add.text(0, 0, '', {
      font: '18px Arial',
      fill: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      padding: { x: 6, y: 4 },
      align: 'center'
    }).setOrigin(0.5, 1).setDepth(200).setVisible(false);
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-SPACE', () => {
      socket.emit('interact', { room: window.roomName, playerId: window.playerId });
    });
  
    socket.emit('join', { room: window.roomName }, (data) => {
      window.playerId = data.playerId;
    });
  
    socket.on('state_update', (state) => {
      this.serverState = state;
      this.updateObjects();
      
      // スコアは既存の DOM 表示をそのままとする（必要であれば Phaser テキストに変更可能）
      document.getElementById('score').textContent = 'スコア: ' + state.score;
  
      this.renderOrders(state);
  
      // タイマー表示: 画面右下に更新
      this.timerText.setText('タイマー: ' + state.timer);
      this.scoreText.setText('スコア: ' + state.score);
  
      if (state.gameOver) {
        document.getElementById('ui').innerHTML = '<h2>ゲーム終了</h2><p>スコア: ' + state.score + '</p>';
      }
  
      if (state.players[window.playerId] && state.players[window.playerId].currentItem) {
        let ci = state.players[window.playerId].currentItem;
        let disp = ci.display || `${ci.type} (${ci.state === 'raw' ? '生' : ci.state === 'chopped' ? '切った' : '焼けた'})`;
        document.getElementById('inventory').textContent = '持ち物: ' + disp;
      } else {
        document.getElementById('inventory').textContent = '持ち物: なし';
      }
    });
  
    socket.on('force_disconnect', () => {
      socket.disconnect();
      document.getElementById('start-overlay').style.display = "block";
      document.getElementById('game-container').style.display = "none";
      document.getElementById('ui').style.display = "none";
    });
  
    this.physics.add.collider(this.playerSprite, this.staticObsGroup);
    this.physics.add.collider(this.playerSprite, this.movingObsGroup);
  }

  updateObjects() {
    if (!this.serverState) return;
    const my = this.serverState.players[window.playerId];
    const ITEM_SIZE = 96;
    const SELF_SCALE = 1;
    const OTHER_SCALE = 0.75;
  
    if (my && this.playerSprite) {
      if (my.image) {
        this.playerSprite.setTexture(my.image);
      }
      if (my.currentItem) {
        if (!this.itemOverlay['self']) {
          this.itemOverlay['self'] = this.add.sprite(0, 0, my.currentItem.type)
            .setDisplaySize(ITEM_SIZE * SELF_SCALE, ITEM_SIZE * SELF_SCALE)
            .setDepth(this.playerSprite.depth + 1);
        } else {
          this.itemOverlay['self'].setTexture(my.currentItem.type);
        }
      
        this.itemOverlay['self'].x = this.playerSprite.x;
        this.itemOverlay['self'].y = this.playerSprite.y + 20;
      
        // 🔄 毎回テキスト更新＆表示
        const ci = my.currentItem;
        const disp = ci.display || `${ci.type} (${ci.state === 'raw' ? '生' : ci.state === 'chopped' ? '切った' : ci.state === 'cooked' ? '焼けた' : ci.state})`;
        this.inventoryText.setText(disp);
        this.inventoryText.setVisible(true);
      } else {
        if (this.itemOverlay['self']) {
          this.itemOverlay['self'].destroy();
          delete this.itemOverlay['self'];
        }
        this.inventoryText.setVisible(false);
      }
    }
      
  
    for (let pid in this.serverState.players) {
      if (pid === window.playerId) continue;
      const p = this.serverState.players[pid];
      let sprite = this.otherPlayers[pid];
  
      if (sprite) {
        sprite.x = p.x;
        sprite.y = p.y;
        if (p.image) sprite.setTexture(p.image);
      } else {
        sprite = this.add.sprite(p.x, p.y, p.image || 'player1')
          .setDisplaySize(96, 96)
          .setTint(0x999999);
        this.otherPlayers[pid] = sprite;
      }
  
      if (p.currentItem) {
        if (!this.itemOverlay[pid]) {
          this.itemOverlay[pid] = this.add.sprite(0, 0, p.currentItem.type)
            .setDisplaySize(ITEM_SIZE * OTHER_SCALE, ITEM_SIZE * OTHER_SCALE)
            .setDepth(sprite.depth + 1);
        }
        this.itemOverlay[pid].x = sprite.x;
        this.itemOverlay[pid].y = sprite.y;
      } else if (this.itemOverlay[pid]) {
        this.itemOverlay[pid].destroy();
        delete this.itemOverlay[pid];
      }
    }
  
    for (let pid in this.otherPlayers) {
      if (!this.serverState.players[pid]) {
        this.otherPlayers[pid].destroy();
        delete this.otherPlayers[pid];
        if (this.itemOverlay[pid]) {
          this.itemOverlay[pid].destroy();
          delete this.itemOverlay[pid];
        }
      }
    }
  
    this.itemGroup.clear(true, true);
    for (let item of this.serverState.items) {
      let spr = this.add.sprite(item.x, item.y, item.type).setDisplaySize(96, 96);
      this.itemGroup.add(spr);
    }
  
    // Clear static obstacles before creating them again to prevent duplicates
    this.staticObsGroup.clear(true, true);
    for (let obs of this.serverState.config.staticObstacles) {
      let spr = this.staticObsGroup.create(obs.x, obs.y, 'obstacle2').setDisplaySize(96, 96);
      spr.refreshBody(); // ← staticGroup を使った場合はこれが必要
    }
  
    if (this.serverState.config.movingObstacles && this.movingObsGroup.getLength() === 0) {
      this.serverState.config.movingObstacles.forEach(obs => {
        let spr = this.physics.add.image(obs.x, obs.y, 'obstacle1').setDisplaySize(96, 96);
        spr.setImmovable(true);
        this.tweens.add({
          targets: spr,
          x: spr.x + Phaser.Math.Between(-50, 50),
          duration: 2000,
          yoyo: true,
          repeat: -1,
          ease: 'Linear'
        });
        this.movingObsGroup.add(spr);
      });
    }
      // 調理場の表示を更新（ゾーン数の変化にも対応するため毎回作り直す）
    this.actionZoneGroup.clear(true, true);
    (this.serverState.config.actionZones || []).forEach(z => {
      let tex = 'cooking_zone1';
      if (z.action === 'bake') tex = 'cooking_zone2';
      const img = this.add.image(z.x, z.y, tex).setDisplaySize(z.width, z.height);
      this.actionZoneGroup.add(img);
    });
    if (this.serverState.config.deliveryZone) {
      let dz = this.serverState.config.deliveryZone;
      this.deliveryZoneImage.setPosition(dz.x, dz.y);
      this.deliveryZoneImage.setDisplaySize(dz.width, dz.height);
    }
  
    this.foodGenImages.forEach(img => img.destroy());
    this.foodPreviewImages.forEach(img => img.destroy());
    this.foodGenImages = [];
    this.foodPreviewImages = [];
    this.serverState.config.foodGenerators.forEach(fg => {
      let img = this.add.image(fg.x, fg.y, 'food_generator').setDisplaySize(fg.width, fg.height);
      this.foodGenImages.push(img);
      let preview = this.add.image(fg.x, fg.y, fg.nextFood).setDisplaySize(48, 48);
      this.foodPreviewImages.push(preview);
    });
  
    this.transferGroup.clear(true, true);
    if (this.serverState.config.transferObjects) {
      this.serverState.config.transferObjects.forEach(tr => {
        let srcImg = this.add.image(tr.sourceZone.x, tr.sourceZone.y, "sourceImage")
          .setDisplaySize(tr.sourceZone.width, tr.sourceZone.height);
        let dstImg = this.add.image(tr.destination.x, tr.destination.y, "destinationImage")
          .setDisplaySize(tr.destination.width, tr.destination.height);
        this.transferGroup.add(srcImg);
        this.transferGroup.add(dstImg);
      });
    }
  }

  renderOrders(state) {
    if (!this.orderListEl) return;

    const listEl = this.orderListEl;
    const frag = document.createDocumentFragment();
    const limit = state.config?.orderTimeLimit ?? null;

    state.orders.forEach((order, index) => {
      const card = document.createElement('div');
      card.className = 'order-card';

      const name = document.createElement('div');
      name.className = 'order-card__name';
      name.textContent = `${index + 1}. ${order.dish}`;

      const timer = document.createElement('div');
      timer.className = 'order-card__timer';

      const bar = document.createElement('div');
      bar.className = 'order-card__timer-bar';

      const remaining = Math.max(order.remaining ?? 0, 0);
      const baseLimit = limit ?? Math.max(remaining, 1);
      const ratio = baseLimit > 0 ? Math.min(Math.max(remaining / baseLimit, 0), 1) : 0;
      bar.style.width = `${ratio * 100}%`;
      if (ratio < 0.34) {
        bar.style.background = 'linear-gradient(90deg, #ef5350, #e53935)';
      } else if (ratio < 0.67) {
        bar.style.background = 'linear-gradient(90deg, #ffa726, #fb8c00)';
      }

      timer.appendChild(bar);

      const remainingText = document.createElement('div');
      remainingText.className = 'order-card__remaining';
      remainingText.textContent = `${remaining}秒`;

      card.appendChild(name);
      card.appendChild(timer);
      card.appendChild(remainingText);

      frag.appendChild(card);
    });

    listEl.innerHTML = '';
    listEl.appendChild(frag);
  }
  
  update() {
    if (this.inventoryText && this.inventoryText.visible) {
      this.inventoryText.setPosition(this.playerSprite.x, this.playerSprite.y - 60);
    }
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown) { vx = -200; }
    else if (this.cursors.right.isDown) { vx = 200; }
    if (this.cursors.up.isDown) { vy = -200; }
    else if (this.cursors.down.isDown) { vy = 200; }
    
    // 直接座標を変更するのではなく、速度を設定して物理エンジン経由で移動させる
    this.playerSprite.setVelocity(vx, vy);
    
    // 移動中であればサーバーへ座標情報を送信
    if (vx !== 0 || vy !== 0) {
      socket.emit('move', { room: window.roomName, playerId: window.playerId, x: this.playerSprite.x, y: this.playerSprite.y });
    } else {
      // キー入力がない場合は速度を 0 にする
      this.playerSprite.setVelocity(0, 0);
    }
  }
}

// 以下の window.config の定義とゲームインスタンスの生成を
// DOMContentLoaded イベント内で１度だけ実行するように変更
window.config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
  scene: [GameScene]
};

// ゲーム開始処理を関数化して外部から呼び出せるようにする
window.startGame = function () {
  // 二重起動対策
  if (window.game) {
    try {
      window.game.destroy(true);
      const container = document.getElementById('game-container');
      if (container) container.innerHTML = "";
    } catch (e) {
      console.error("ゲーム破棄エラー:", e);
    }
  }

  window.game = new Phaser.Game(window.config);
};

// DOMContentLoaded 後にスタートボタンにハンドラを登録
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById('startButton').addEventListener('click', window.startGame);
});