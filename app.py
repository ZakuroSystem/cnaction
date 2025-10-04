import os
import time
import random
import uuid
from dataclasses import asdict
from threading import Lock
from typing import Dict
import json

from flask import (
    Flask, Blueprint, render_template, request, jsonify
)
from flask_socketio import SocketIO, join_room

from utils import (
    get_default_config, in_zone, parse_transfer_objects,
    find_next_step, update_orders, process_combinations,
    export_config_response, save_uploaded_file, build_order
)
from models import Item, Player, RoomState

# ─────────────────────────────────────────
# App & SocketIO 初期化
# ─────────────────────────────────────────
app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
socketio = SocketIO(app, cors_allowed_origins="*")


def _static_mtime(path: str) -> int:
    """Return the last modified timestamp for a static asset."""
    try:
        return int(os.path.getmtime(os.path.join(app.static_folder, path)))
    except OSError:
        # Fallback to current time so cache busting still occurs if the file is
        # missing during development.
        return int(time.time())

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
# ステージ管理 API
# ─────────────────────────────────────────
@bp.route('/api/stages', methods=['GET', 'POST'])
def api_stages():
    if request.method == 'GET':
        stages = []
        for fname in os.listdir(STAGE_DIR):
            if not fname.endswith('.json'):
                continue
            key = os.path.splitext(fname)[0]
            path = os.path.join(STAGE_DIR, fname)
            meta = {}
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                meta = data.get('meta', {})
            except Exception:
                pass
            stages.append({
                'key': key,
                'name': meta.get('name', key),
                'updated': int(meta.get('updated', os.path.getmtime(path)))
            })
        stages.sort(key=lambda s: s['updated'], reverse=True)
        return jsonify(stages=stages)

    payload = request.get_json(force=True)
    key = payload.get('key') or str(int(time.time()))
    name = payload.get('name', key)
    config = payload.get('config', {})
    meta = {'name': name, 'updated': int(time.time())}
    try:
        with open(_stage_path(key), 'w', encoding='utf-8') as f:
            json.dump({'meta': meta, 'config': config}, f, ensure_ascii=False, indent=2)
        return jsonify(ok=True, key=key)
    except Exception as e:
        return jsonify(ok=False, msg=str(e)), 500


@bp.route('/api/stages/<key>')
def api_stage_get(key: str):
    path = _stage_path(key)
    if not os.path.exists(path):
        return jsonify(error='not found'), 404
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return jsonify(data)

@bp.route('/api/default_config')
def api_default_config():
    """Return built-in default configuration."""
    return jsonify(get_default_config())

# ─────────────────────────────────────────
# 画像アップロード設定
# ─────────────────────────────────────────
UPLOAD_FOLDER = os.path.join(app.static_folder, 'assets', 'ingredient')
BACKUP_FOLDER = os.path.join(app.static_folder, 'assets', 'backup')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(BACKUP_FOLDER, exist_ok=True)
ALLOWED_EXT = {'.png', '.jpg', '.jpeg', '.gif'}
UPLOAD_PASSWORD = '1234'


# 全部屋の状態
rooms: Dict[str, RoomState] = {}
# dirty-flag for broadcast
dirty_flags: Dict[str, bool] = {}
# sid → (room, playerId)
sid_to_player: Dict[str, tuple] = {}

ACTION_STATE_MAP = {
    'cut': 'chopped',
    'bake': 'cooked',
    'fry': 'cooked',
    'grill': 'cooked',
    'boil': 'boiled',
    'mix': 'mixed',
}


def infer_state(action: str, fallback: str) -> str:
    return ACTION_STATE_MAP.get(action, fallback or 'prepared')

# ─────────────────────────────────────────
# ユーティリティ関数
# ─────────────────────────────────────────
_flush_lock = Lock()
_flush_pending = False


def mark_dirty(room: str):
    dirty_flags[room] = True
    schedule_flush()


def flush_dirty():
    for room in list(dirty_flags.keys()):
        if room not in rooms:
            dirty_flags.pop(room, None)
            continue
        state = asdict(rooms[room])
        socketio.emit('state_update', state, room=room)
        dirty_flags.pop(room, None)


def schedule_flush(delay: float = 1 / 30):
    global _flush_pending
    with _flush_lock:
        if _flush_pending:
            return
        _flush_pending = True

    def runner():
        global _flush_pending
        try:
            socketio.sleep(delay)
            flush_dirty()
        finally:
            with _flush_lock:
                _flush_pending = False

    socketio.start_background_task(runner)

def in_zone(x: float, y: float, zone: dict) -> bool:
    return (
        zone['x'] - zone['width']/2 <= x <= zone['x'] + zone['width']/2 and
        zone['y'] - zone['height']/2 <= y <= zone['y'] + zone['height']/2
    )


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
    for zone in cfg.get('actionZones', []):
        zone.setdefault('occupied', False)
        zone.pop('cooking', None)
    if isinstance(cfg.get('transferObjects'), str):
        cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])

    rs = RoomState()
    rs.config = cfg
    rs.timer = cfg.get('gameTime', rs.timer)
    rs.orders = [build_order(cfg) for _ in range(3)]

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
    save_uploaded_file(file, dest, BACKUP_FOLDER, item_name)

    return jsonify(success=True, path=f"/static/assets/ingredient/{safe}")

# ─────────────────────────────────────────
# HTTP ルート
# ─────────────────────────────────────────
@bp.route('/')
def index():
    return render_template('index.html', main_js_version=_static_mtime('main.js'))

@bp.route('/editor')
def editor():
    """Stage editor page."""
    return render_template('editor.html')

@bp.route('/admin')
def admin():
    return render_template('admin.html')

@bp.route('/admin_state')
def admin_state():
    return jsonify({r: asdict(rs) for r, rs in rooms.items()})

@bp.route('/export_config')
def export_config():
    room = request.args.get('room', '')
    return export_config_response(room, rooms)

@bp.route('/reset_room', methods=['POST'])
def reset_room():
    room = request.form.get('room', '')
    if room not in rooms:
        return "Room not found", 404
    rs = rooms[room]
    cfg = rs.config
    for zone in cfg.get('actionZones', []):
        zone['occupied'] = False
        zone.pop('cooking', None)
    rs.timer = cfg.get('gameTime', rs.timer)
    rs.score = 0
    rs.gameOver = False
    rs.orders = [build_order(cfg) for _ in range(3)]
    rs.resetScheduled = False
    mark_dirty(room)
    return "Reset", 200

# ─────────────────────────────────────────
# SocketIO イベント
# ─────────────────────────────────────────
def run_cooking_task(room: str, zone: dict, task: dict):
    duration = max(float(task.get('duration', 1.0) or 0.0), 0.1)
    start = time.time()
    task['startedAt'] = start
    task['duration'] = duration

    while True:
        socketio.sleep(0.1)
        if room not in rooms:
            return
        current = zone.get('cooking')
        if not current or current.get('id') != task['id']:
            return

        elapsed = time.time() - start
        progress = max(0.0, min(elapsed / duration, 1.0))
        current['progress'] = progress
        current['elapsed'] = elapsed
        current['remaining'] = max(duration - elapsed, 0.0)
        mark_dirty(room)

        if progress >= 1.0:
            break

    if room not in rooms:
        return

    rs = rooms[room]
    current = zone.get('cooking')
    if not current or current.get('id') != task['id']:
        return

    cooked = Item(
        id=rs.nextItemId,
        type=task['result_type'],
        x=zone['x'],
        y=zone['y'],
        state=task['result_state'],
    )
    rs.nextItemId += 1
    if task.get('result_display'):
        cooked.display = task['result_display']
    rs.items.append(cooked)

    zone['occupied'] = False
    zone.pop('cooking', None)
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
        for zone in cfg.get('actionZones', []):
            zone.setdefault('occupied', False)
            zone.pop('cooking', None)
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
        if p.currentItem:
            p.currentItem.x, p.currentItem.y = nx, ny
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
                itm = p.currentItem
                p.currentItem = None
                p.cooking = False
                p.currentZone = None
                p.image = p.base_image

                duration = float(step.get('time', 1.0) or 1.0)
                cooking_id = uuid.uuid4().hex
                task = {
                    'id': cooking_id,
                    'progress': 0.0,
                    'duration': duration,
                    'texture': getattr(itm, 'type', None),
                    'itemType': getattr(itm, 'type', None),
                    'displayText': zone.get('display') or '調理中…',
                    'result_type': step['result'],
                    'result_state': infer_state(step.get('action', ''), getattr(itm, 'state', 'raw')),
                    'result_display': None,
                    'startedAt': time.time(),
                }
                zone['cooking'] = task

                socketio.start_background_task(
                    run_cooking_task, room, zone, task
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
            rs.orders.append(build_order(cfg))
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
            update_orders(room, rooms)
            process_combinations(room, rooms, Item)
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
