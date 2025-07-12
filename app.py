import os
import time
import random
import json
import itertools
import shutil
import datetime
from io import BytesIO
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional

from flask import (
    Flask, Blueprint, render_template, request, jsonify, send_file
)
from flask_socketio import SocketIO, join_room

# ─────────────────────────────────────────
# App & SocketIO 初期化
# ─────────────────────────────────────────
app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# ─────────────────────────────────────────
# Blueprint 登録
# ─────────────────────────────────────────
bp = Blueprint('core', __name__)

# ─────────────────────────────────────────
# ステージ保存用ディレクトリ
# ─────────────────────────────────────────
STAGE_DIR = os.path.join(app.root_path, 'stages')
os.makedirs(STAGE_DIR, exist_ok=True)

def _stage_path(key: str) -> str:
    return os.path.join(STAGE_DIR, f'{key}.json')

# ─────────────────────────────────────────
# 画像アップロード設定
# ─────────────────────────────────────────
UPLOAD_FOLDER = os.path.join(app.static_folder, 'assets', 'ingredient')
BACKUP_FOLDER = os.path.join(app.static_folder, 'assets', 'backup')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(BACKUP_FOLDER, exist_ok=True)
ALLOWED_EXT = {'.png', '.jpg', '.jpeg', '.gif'}
UPLOAD_PASSWORD = '1234'

# ─────────────────────────────────────────
# デフォルト設定・型定義
# ─────────────────────────────────────────
def get_default_config() -> dict:
    return {
        'gameTime': 150,
        'orderTimeLimit': 90,
        'wrongOrderPenalty': 5,
        'actionZones': [
            {'x': 100, 'y': 500, 'width': 150, 'height': 150,
             'action': 'cut', 'display': '切っている…', 'occupied': False},
            {'x': 300, 'y': 500, 'width': 150, 'height': 150,
             'action': 'bake', 'display': '焼いている…', 'occupied': False},
        ],
        'deliveryZone': {'x': 700, 'y': 500, 'width': 150, 'height': 150},
        'movingObstacles': [{'x': 400, 'y': 300, 'width': 96, 'height': 96}],
        'staticObstacles': [{'x': 600, 'y': 300, 'width': 96, 'height': 96}],
        'foodGenerators': [{
            'x': 750, 'y': 50, 'width': 96, 'height': 96,
            'nextFood': random.choice(
                ['ingredient_tomato', 'ingredient_lettuce', 'ingredient_bread']
            )
        }],
        'transferObjects': [],
        'customItems': [],
        'combinationRecipes': [],
        'cookingRecipes': [],
        'dishList': [
            'トマト(切って焼いたもの)',
            'レタス(切って焼いたもの)',
            'バンズ(切って焼いたもの)'
        ],
        'orderMapping': {
            'ingredient_tomato': 'トマト(切って焼いたもの)',
            'ingredient_lettuce': 'レタス(切って焼いたもの)',
            'ingredient_bread': 'バンズ(切って焼いたもの)'
        }
    }

@dataclass
class Item:
    id: int
    type: str
    x: float
    y: float
    state: str = 'raw'
    display: Optional[str] = None

@dataclass
class Player:
    x: float = 100
    y: float = 100
    currentItem: Optional[Item] = None
    cooking: bool = False
    currentZone: Optional[dict] = None
    base_image: str = ''
    image: str = ''

@dataclass
class RoomState:
    players: Dict[str, Player] = field(default_factory=dict)
    items: List[Item] = field(default_factory=list)
    orders: List[dict] = field(default_factory=list)
    score: int = 0
    timer: int = 60
    gameOver: bool = False
    config: dict = field(default_factory=get_default_config)
    nextItemId: int = 1
    resetScheduled: bool = False

# 全部屋の状態
rooms: Dict[str, RoomState] = {}
# dirty-flag for broadcast
dirty_flags: Dict[str, bool] = {}
# sid → (room, playerId)
sid_to_player: Dict[str, tuple] = {}

# ─────────────────────────────────────────
# ユーティリティ関数
# ─────────────────────────────────────────
def mark_dirty(room: str):
    dirty_flags[room] = True

def flush_dirty():
    for room in list(dirty_flags.keys()):
        state = asdict(rooms[room])
        socketio.emit('state_update', state, room=room)
        dirty_flags.pop(room, None)

def coalesce_broadcast_loop():
    while True:
        socketio.sleep(1)
        flush_dirty()

def in_zone(x: float, y: float, zone: dict) -> bool:
    return (
        zone['x'] - zone['width']/2 <= x <= zone['x'] + zone['width']/2 and
        zone['y'] - zone['height']/2 <= y <= zone['y'] + zone['height']/2
    )

def parse_transfer_objects(s: str) -> list:
    objs = []
    for part in s.split(';'):
        part = part.strip()
        if not part:
            continue
        try:
            src, dst = part.split('->')
            sx, sy, sw, sh = map(float, src.split(','))
            dx, dy, dw, dh = map(float, dst.split(','))
            objs.append({
                'sourceZone': {'x': sx, 'y': sy, 'width': sw, 'height': sh},
                'destination': {'x': dx, 'y': dy, 'width': dw, 'height': dh}
            })
        except:
            pass
    return objs

def find_next_step(cfg: dict, item_type: str) -> Optional[dict]:
    return next((
        {'action': step['action'], 'result': step['result'], 'time': step['time']}
        for r in cfg.get('cookingRecipes', [])
        for prev, step in zip(
            [{'result': r['base']}],
            r['steps']
        ) + list(zip(r['steps'], r['steps'][1:]))
        if prev['result'] == item_type
    ), None)

def update_orders(room: str):
    rs = rooms[room]
    cfg = rs.config
    new_orders = []
    for o in rs.orders:
        o['remaining'] = max(0, o['remaining'] - 1)
        if o['remaining'] <= 0:
            rs.score -= cfg.get('wrongOrderPenalty', 5)
            new_orders.append({
                'dish': random.choice(cfg.get('dishList', [])),
                'remaining': cfg.get('orderTimeLimit', 30)
            })
        else:
            new_orders.append(o)
    rs.orders = new_orders

def process_combinations(room: str):
    rs = rooms[room]
    items = rs.items
    to_remove = set()
    new_items: List[Item] = []
    for rec in rs.config.get('combinationRecipes', []):
        req = rec['ingredients']
        thresh = rec['threshold']
        result = rec['result']
        mapping = {t: [i for i, it in enumerate(items) if it.type == t] for t in req}
        if all(mapping.get(t) for t in req):
            for combo in itertools.product(*(mapping[t] for t in req)):
                if len(set(combo)) < len(combo):
                    continue
                coords = [(items[i].x, items[i].y) for i in combo]
                if all(
                    ((x1-x2)**2 + (y1-y2)**2) ** 0.5 <= thresh
                    for (x1,y1),(x2,y2)
                    in itertools.combinations(coords,2)
                ):
                    for i in combo:
                        to_remove.add(i)
                    avgx = sum(x for x,y in coords)/len(coords)
                    avgy = sum(y for x,y in coords)/len(coords)
                    new_items.append(Item(
                        id=rs.nextItemId,
                        type=result,
                        x=avgx,
                        y=avgy
                    ))
                    rs.nextItemId += 1
                    break
    if to_remove:
        rs.items = [it for idx, it in enumerate(items) if idx not in to_remove]
        rs.items.extend(new_items)

def initialize_room(room: str, config: dict = None):
    cfg = config or get_default_config()
    if 'actionZones' not in cfg:
        cfg['actionZones'] = []
    for z in cfg.pop('choppingZones', []):
        z.update({'action': 'cut', 'display': '切っている…'})
        cfg['actionZones'].append(z)
    for z in cfg.pop('bakingZones', []):
        z.update({'action': 'bake', 'display': '焼いている…'})
        cfg['actionZones'].append(z)
    if isinstance(cfg.get('transferObjects'), str):
        cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])

    rs = RoomState()
    rs.config = cfg
    rs.timer = cfg.get('gameTime', rs.timer)
    rs.orders = [{
        'dish': random.choice(cfg.get('dishList', [])),
        'remaining': cfg.get('orderTimeLimit', 30)
    } for _ in range(3)]

    for _ in range(3):
        itm = Item(
            id=rs.nextItemId,
            type=random.choice(list(cfg['orderMapping'].keys())),
            x=random.randint(50,750),
            y=random.randint(50,550)
        )
        rs.items.append(itm)
        rs.nextItemId += 1

    rooms[room] = rs
    mark_dirty(room)

# ─────────────────────────────────────────
# 画像アップロードエンドポイント
# ─────────────────────────────────────────
@bp.route('/upload_image', methods=['POST'])
def upload_image():
    pwd = request.form.get('password', '')
    if pwd != UPLOAD_PASSWORD:
        return jsonify(success=False, message="パスワードが違います"), 403

    item_name = request.form.get('item_name', '').strip()
    file = request.files.get('file')
    if not item_name or not file:
        return jsonify(success=False, message="必要項目が不足"), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify(success=False, message="許可外拡張子"), 400

    safe = f"{item_name}{ext}"
    dest = os.path.join(UPLOAD_FOLDER, safe)

    if os.path.exists(dest):
        ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        shutil.move(dest, os.path.join(BACKUP_FOLDER, f"{item_name}_{ts}{ext}"))
    file.save(dest)

    return jsonify(success=True, path=f"/static/assets/ingredient/{safe}")

# ─────────────────────────────────────────
# HTTP ルート
# ─────────────────────────────────────────
@bp.route('/')
def index():
    return render_template('index.html')

@bp.route('/settings')
def settings():
    return render_template('settings.html')

@bp.route('/admin')
def admin():
    return render_template('settings.html')

@bp.route('/admin_state')
def admin_state():
    return jsonify({r: asdict(rs) for r, rs in rooms.items()})

@bp.route('/export_config')
def export_config():
    room = request.args.get('room', '')
    cfg = rooms.get(room, RoomState()).config
    js = json.dumps(cfg, ensure_ascii=False, indent=2)
    return send_file(BytesIO(js.encode('utf-8')),
                     mimetype='application/json',
                     as_attachment=True,
                     download_name=f'{room or "default"}_config.json')

@bp.route('/reset_room', methods=['POST'])
def reset_room():
    room = request.form.get('room', '')
    if room not in rooms:
        return "Room not found", 404
    rs = rooms[room]
    cfg = rs.config
    rs.timer = cfg.get('gameTime', rs.timer)
    rs.score = 0
    rs.gameOver = False
    rs.orders = [{
        'dish': random.choice(cfg.get('dishList', [])),
        'remaining': cfg.get('orderTimeLimit', 30)
    } for _ in range(3)]
    rs.resetScheduled = False
    mark_dirty(room)
    return "Reset", 200

# ─────────────────────────────────────────
# SocketIO イベント
# ─────────────────────────────────────────
def complete_task(room: str, player_id: str, zone: dict, action: str, new_type: str, delay: float):
    time.sleep(delay)
    if room in rooms and player_id in rooms[room].players:
        p = rooms[room].players[player_id]
        if p.cooking and p.currentItem:
            p.currentItem.type = new_type
            p.cooking = False
            if p.currentZone:
                p.currentZone['occupied'] = False
            p.currentZone = None
            p.image = p.base_image
            mark_dirty(room)

@socketio.on('join')
def on_join(data):
    room = data.get('room', 'room1')
    if room not in rooms:
        initialize_room(room)
    join_room(room)
    rs = rooms[room]
    pid = f"player{len(rs.players)+1}"
    rs.players[pid] = Player(base_image=pid, image=pid)
    sid_to_player[request.sid] = (room, pid)
    mark_dirty(room)
    return {'playerId': pid}

@socketio.on('disconnect')
def on_disconnect():
    info = sid_to_player.pop(request.sid, None)
    if not info:
        return
    room, pid = info
    if room in rooms and pid in rooms[room].players:
        rooms[room].players.pop(pid)
        mark_dirty(room)

@socketio.on('update_config')
def on_update_config(data):
    room, cfg = data.get('room'), data.get('config')
    if room not in rooms:
        initialize_room(room, cfg)
    else:
        if isinstance(cfg.get('transferObjects'), str):
            cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])
        rooms[room].config = cfg
        mark_dirty(room)

@socketio.on('move')
def on_move(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in rooms or pid not in rooms[room].players:
        return
    p = rooms[room].players[pid]
    nx, ny = data.get('x'), data.get('y')
    cfg = rooms[room].config
    obs = cfg.get('movingObstacles', []) + cfg.get('staticObstacles', [])
    if not any(in_zone(nx, ny, o) for o in obs):
        p.x, p.y = nx, ny
    if p.cooking and p.currentZone:
        p.currentZone['occupied'] = False
        p.cooking = False
        p.currentZone = None
    mark_dirty(room)

@socketio.on('interact')
def on_interact(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in rooms or pid not in rooms[room].players:
        return
    rs, p = rooms[room], rooms[room].players[pid]
    x, y = p.x, p.y
    cfg = rs.config

    # アイテム取得 or 生成
    if p.currentItem is None:
        for itm in rs.items:
            if ((itm.x - x)**2 + (itm.y - y)**2) ** 0.5 < 50:
                p.currentItem = itm
                rs.items.remove(itm)
                mark_dirty(room)
                return
        for fg in cfg.get('foodGenerators', []):
            if in_zone(x, y, fg):
                new_itm = Item(
                    id=rs.nextItemId,
                    type=fg['nextFood'],
                    x=x, y=y
                )
                rs.nextItemId += 1
                p.currentItem = new_itm
                fg['nextFood'] = random.choice(list(cfg['orderMapping']))
                mark_dirty(room)
                return
        return

    # 調理ステップ
    step = find_next_step(cfg, p.currentItem.type)
    if step:
        for zone in cfg['actionZones']:
            if not zone['occupied'] and zone['action'] == step['action'] and in_zone(x, y, zone):
                zone['occupied'] = True
                p.cooking = True
                p.currentZone = zone
                p.currentItem.display = zone['display']
                socketio.start_background_task(
                    complete_task, room, pid, zone,
                    step['action'], step['result'], step['time']
                )
                mark_dirty(room)
                return

    # 配膳
    if in_zone(x, y, cfg['deliveryZone']):
        delivered = cfg['orderMapping'].get(p.currentItem.type, '不明')
        expected = rs.orders[0]['dish'] if rs.orders else None
        if delivered == expected:
            rs.score += 10
            rs.orders.pop(0)
            rs.orders.append({
                'dish': random.choice(cfg['dishList']),
                'remaining': cfg['orderTimeLimit']
            })
        else:
            rs.score -= cfg['wrongOrderPenalty']
        p.currentItem = None
        mark_dirty(room)
        return

    # 置く or 転送
    itm = p.currentItem
    itm.x, itm.y = x, y
    itm.id = rs.nextItemId
    rs.nextItemId += 1
    for tr in cfg.get('transferObjects', []):
        if in_zone(x, y, tr['sourceZone']):
            itm.x, itm.y = tr['destination']['x'], tr['destination']['y']
            break
    rs.items.append(itm)
    p.currentItem = None
    mark_dirty(room)

# ─────────────────────────────────────────
# ゲームタイマー起動
# ─────────────────────────────────────────
app.register_blueprint(bp)
socketio.start_background_task(coalesce_broadcast_loop)
def game_timer_task():
    while True:
        socketio.sleep(1)
        for room in list(rooms.keys()):
            rs = rooms[room]
            if rs.timer > 0:
                rs.timer -= 1
                if rs.timer <= 0:
                    rs.gameOver = True
                    rs.items.clear()
            update_orders(room)
            process_combinations(room)
            mark_dirty(room)
            if rs.gameOver and not rs.resetScheduled:
                rs.resetScheduled = True
                socketio.start_background_task(lambda r=room: (socketio.sleep(10), rooms.pop(r, None)))
socketio.start_background_task(game_timer_task)

# ─────────────────────────────────────────
# サーバ起動
# ─────────────────────────────────────────
if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=8071)