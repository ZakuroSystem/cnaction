import json
import os
import time

from flask import Flask, Blueprint, render_template, request, jsonify
from flask_socketio import SocketIO, join_room

from cnaction import game
from cnaction.config import sanitize_config
from utils import (
    export_config_response,
    get_default_config,
    parse_transfer_objects,
    save_uploaded_file,
    update_orders,
)
from models import Player

# ─────────────────────────────────────────
# App & SocketIO 初期化
# ─────────────────────────────────────────
app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['SECRET_KEY'] = 'secret!'
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
socketio = SocketIO(app, cors_allowed_origins="*")
game.init(socketio)


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
    return jsonify({r: game.serialize_room_state(rs) for r, rs in game.rooms.items()})

@bp.route('/export_config')
def export_config():
    room = request.args.get('room', '')
    return export_config_response(room, game.rooms)

@bp.route('/reset_room', methods=['POST'])
def reset_room():
    room = request.form.get('room', '')
    if not game.reset_room(room):
        return "Room not found", 404
    return "Reset", 200

# ─────────────────────────────────────────
# SocketIO イベント
# ─────────────────────────────────────────
@socketio.on('join')
def on_join(data):
    room = data.get('room', 'room1')
    if room not in game.rooms:
        game.initialize_room(room)
    join_room(room)
    rs = game.rooms[room]
    pid = f"player{len(rs.players)+1}"
    rs.players[pid] = Player(base_image=pid, image=pid)
    game.sid_to_player[request.sid] = (room, pid)
    rs.hostId = ''
    rs.clientManaged = False
    game.mark_dirty(room)
    return {'playerId': pid, 'isHost': False, 'clientManaged': rs.clientManaged}

@socketio.on('disconnect')
def on_disconnect():
    info = game.sid_to_player.pop(request.sid, None)
    if not info:
        return
    room, pid = info
    if room in game.rooms and pid in game.rooms[room].players:
        game.rooms[room].players.pop(pid)
        rs = game.rooms[room]
        if rs.hostId == pid:
            rs.hostId = ''
            rs.clientManaged = False
        game.mark_dirty(room)

@socketio.on('update_config')
def on_update_config(data):
    room, cfg = data.get('room'), data.get('config')
    if room not in game.rooms:
        game.initialize_room(room, cfg)
    else:
        cfg = sanitize_config(cfg)
        if isinstance(cfg.get('transferObjects'), str):
            cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])
        game.assign_room_config(game.rooms[room], cfg)
        game.mark_dirty(room)

@socketio.on('move')
def on_move(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in game.rooms or pid not in game.rooms[room].players:
        return
    rs = game.rooms[room]
    p = rs.players[pid]
    try:
        nx = float(data.get('x'))
        ny = float(data.get('y'))
    except (TypeError, ValueError):
        return

    moved, obstacles_moved = game.apply_player_move(rs, p, nx, ny)
    if rs.clientManaged:
        socketio.emit('client_move', {
            'playerId': pid,
            'room': room,
            'x': p.x,
            'y': p.y,
        }, room=room)
    if moved or obstacles_moved:
        game.mark_dirty(room)

@socketio.on('interact')
def on_interact(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in game.rooms or pid not in game.rooms[room].players:
        return
    rs, p = game.rooms[room], game.rooms[room].players[pid]
    if rs.clientManaged:
        payload = {
            'playerId': pid,
            'room': room,
            'x': data.get('x'),
            'y': data.get('y'),
        }
        socketio.emit('client_interact', payload, room=room)
        return
    x, y = p.x, p.y
    position_updated = False
    if 'x' in data and 'y' in data:
        try:
            nx = float(data.get('x'))
            ny = float(data.get('y'))
        except (TypeError, ValueError):
            nx = None
            ny = None
        if nx is not None and ny is not None:
            moved, obstacles_moved = game.apply_player_move(rs, p, nx, ny)
            x, y = p.x, p.y
            position_updated = moved or obstacles_moved

    if p.currentItem is None:
        if game.try_pickup_world_item(rs, room, p, x, y):
            game.mark_dirty(room)
            return
        if game.try_spawn_from_generator(rs, p, x, y):
            game.mark_dirty(room)
            return
        if position_updated:
            game.mark_dirty(room)
        return

    item = p.currentItem
    action_info = game.resolve_cooking_action(rs, item)
    if action_info and game.start_cooking_action(room, rs, p, x, y, item, action_info):
        game.mark_dirty(room)
        return

    if game.try_deliver_item(rs, p, x, y):
        game.mark_dirty(room)
        return

    item.x = x
    item.y = y

    if game.try_stack_combination(rs, room, p, item):
        game.mark_dirty(room)
        return

    game.drop_item_to_world(rs, room, p, item, x, y)
    game.mark_dirty(room)


@socketio.on('client_state')
def on_client_state(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in game.rooms or pid not in game.rooms[room].players:
        return
    rs = game.rooms[room]
    if not rs.clientManaged:
        return
    if rs.hostId and rs.hostId != pid:
        return
    snapshot = data.get('state')
    if not isinstance(snapshot, dict):
        return
    if not rs.hostId:
        rs.hostId = pid
    game.apply_client_state(room, snapshot)
    game.mark_dirty(room)

# ─────────────────────────────────────────
# ゲームタイマー起動
# ─────────────────────────────────────────
app.register_blueprint(bp)
def game_timer_task():
    while True:
        socketio.sleep(1)
        for room in list(game.rooms.keys()):
            rs = game.rooms[room]
            if rs.clientManaged:
                continue
            if rs.timer > 0:
                rs.timer -= 1
                if rs.timer <= 0:
                    rs.gameOver = True
                    game.clear_world_items(rs)
            update_orders(room, game.rooms)
            game.mark_dirty(room)
            if rs.gameOver and not rs.resetScheduled:
                rs.resetScheduled = True
                socketio.start_background_task(
                    lambda r=room: (socketio.sleep(10), game.rooms.pop(r, None))
                )
socketio.start_background_task(game_timer_task)

# ─────────────────────────────────────────
# サーバ起動
# ─────────────────────────────────────────
if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=8071)
