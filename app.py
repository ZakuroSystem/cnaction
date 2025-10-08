import os
import time
import random
import uuid
from threading import Lock
from typing import Dict, Optional
import json

from flask import (
    Flask, Blueprint, render_template, request, jsonify
)
from flask_socketio import SocketIO, join_room

from utils import (
    get_default_config, in_zone, parse_transfer_objects,
    update_orders, export_config_response, save_uploaded_file, build_order,
    ingredient_types, dish_types, get_dish_name, format_item_display,
    default_item_state, default_cooking_recipes, default_combination_recipes,
    find_combination_recipe, build_runtime_metadata, hydrate_order,
    find_cooking_recipe, find_combination_recipe_from_index
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

DEFAULT_ACTION_ZONES = [
    {'x': 100, 'y': 500, 'width': 150, 'height': 150, 'action': 'cut', 'display': '切っている…'},
    {'x': 300, 'y': 500, 'width': 150, 'height': 150, 'action': 'bake', 'display': '焼いている…'},
]
DEFAULT_DELIVERY_ZONE = {'x': 700, 'y': 500, 'width': 150, 'height': 150}
DEFAULT_GENERATOR = {'x': 750, 'y': 50, 'width': 96, 'height': 96}
DEFAULT_CUT_DURATION = 2.0
DEFAULT_BAKE_DURATION = 3.0
PLAYFIELD_WIDTH = 800
PLAYFIELD_HEIGHT = 600
PLAYER_RADIUS = 32
_COLLISION_EPSILON = 1e-6

def _clone_default_action_zones():
    zones = []
    for zone in DEFAULT_ACTION_ZONES:
        cloned = dict(zone)
        cloned['occupied'] = False
        cloned.pop('cooking', None)
        zones.append(cloned)
    return zones

def sanitize_config(cfg: dict) -> dict:
    cfg = dict(cfg or {})

    ingredient_list = ingredient_types()
    dish_list = dish_types()
    default_mapping = {t: get_dish_name(t) or t for t in dish_list}

    sanitized_mapping = {}
    if isinstance(cfg.get('orderMapping'), dict):
        for item_type, dish_name in cfg['orderMapping'].items():
            if item_type not in dish_list:
                continue
            if not isinstance(dish_name, str) or not dish_name.strip():
                continue
            sanitized_mapping[item_type] = dish_name.strip()
    if not sanitized_mapping:
        sanitized_mapping = default_mapping
    cfg['orderMapping'] = sanitized_mapping

    sanitized_dishes = []
    if isinstance(cfg.get('dishList'), (list, tuple)):
        for dish_name in cfg['dishList']:
            if isinstance(dish_name, str) and dish_name.strip():
                sanitized_dishes.append(dish_name.strip())
    if not sanitized_dishes:
        sanitized_dishes = list(dict.fromkeys(sanitized_mapping.values()))
    cfg['dishList'] = sanitized_dishes

    chopping = cfg.pop('choppingZones', []) or []
    baking = cfg.pop('bakingZones', []) or []
    source_zones = list(cfg.get('actionZones', []))
    for zone in chopping:
        cloned = dict(zone)
        cloned['action'] = 'cut'
        source_zones.append(cloned)
    for zone in baking:
        cloned = dict(zone)
        cloned['action'] = 'bake'
        source_zones.append(cloned)

    sanitized_zones = []
    for zone in source_zones:
        action = zone.get('action')
        if action not in ('cut', 'bake'):
            continue
        cloned = dict(zone)
        cloned['action'] = action
        cloned['display'] = zone.get('display') or ('切っている…' if action == 'cut' else '焼いている…')
        cloned['width'] = zone.get('width', 150)
        cloned['height'] = zone.get('height', 150)
        occupied = bool(zone.get('occupied'))

        cooking_payload = zone.get('cooking') if isinstance(zone.get('cooking'), dict) else None
        sanitized_task = None
        if cooking_payload:
            duration_raw = cooking_payload.get('duration')
            try:
                duration_val = float(duration_raw)
            except (TypeError, ValueError):
                duration_val = None
            if not duration_val or duration_val <= 0:
                duration_val = cfg['cutDuration'] if action == 'cut' else cfg['bakeDuration']

            try:
                progress_val = float(cooking_payload.get('progress'))
            except (TypeError, ValueError):
                progress_val = 0.0
            progress_val = max(0.0, min(progress_val, 1.0))

            result_type = cooking_payload.get('result_type') or cooking_payload.get('itemType')
            result_state = cooking_payload.get('result_state')
            if result_type and not result_state:
                result_state = default_item_state(result_type)

            try:
                started_at = float(cooking_payload.get('startedAt'))
            except (TypeError, ValueError):
                started_at = time.time()

            sanitized_task = {
                'id': str(cooking_payload.get('id') or uuid.uuid4().hex),
                'progress': progress_val,
                'duration': duration_val,
                'texture': cooking_payload.get('texture'),
                'itemType': cooking_payload.get('itemType'),
                'displayText': cooking_payload.get('displayText') or cloned['display'],
                'result_type': result_type,
                'result_state': result_state,
                'result_display': cooking_payload.get('result_display') or (
                    format_item_display(result_type, result_state) if result_type else None
                ),
                'startedAt': started_at,
            }
            if cooking_payload.get('elapsed') is not None:
                try:
                    sanitized_task['elapsed'] = max(0.0, float(cooking_payload.get('elapsed')))
                except (TypeError, ValueError):
                    pass
            if cooking_payload.get('remaining') is not None:
                try:
                    sanitized_task['remaining'] = max(0.0, float(cooking_payload.get('remaining')))
                except (TypeError, ValueError):
                    pass

        if sanitized_task:
            cloned['cooking'] = sanitized_task
            occupied = True
        else:
            cloned.pop('cooking', None)

        cloned['occupied'] = occupied
        sanitized_zones.append(cloned)

    if not sanitized_zones:
        sanitized_zones = _clone_default_action_zones()

    cfg['actionZones'] = sanitized_zones

    delivery = dict(cfg.get('deliveryZone') or {})
    if not delivery:
        delivery = dict(DEFAULT_DELIVERY_ZONE)
    else:
        delivery.setdefault('width', DEFAULT_DELIVERY_ZONE['width'])
        delivery.setdefault('height', DEFAULT_DELIVERY_ZONE['height'])
        delivery.setdefault('x', DEFAULT_DELIVERY_ZONE['x'])
        delivery.setdefault('y', DEFAULT_DELIVERY_ZONE['y'])
    cfg['deliveryZone'] = delivery

    try:
        cfg['cutDuration'] = float(cfg.get('cutDuration', DEFAULT_CUT_DURATION) or DEFAULT_CUT_DURATION)
    except (TypeError, ValueError):
        cfg['cutDuration'] = DEFAULT_CUT_DURATION
    try:
        cfg['bakeDuration'] = float(cfg.get('bakeDuration', DEFAULT_BAKE_DURATION) or DEFAULT_BAKE_DURATION)
    except (TypeError, ValueError):
        cfg['bakeDuration'] = DEFAULT_BAKE_DURATION

    sanitized_cooking = []
    for recipe in cfg.get('cookingRecipes', []) or []:
        if not isinstance(recipe, dict):
            continue
        typ = recipe.get('type')
        action = recipe.get('action')
        to_state = recipe.get('to')
        if not typ or not action or to_state is None:
            continue
        sanitized = dict(recipe)
        sanitized['type'] = typ
        sanitized['action'] = action
        sanitized['to'] = to_state
        sanitized['from'] = recipe.get('from')
        try:
            duration_val = float(recipe.get('duration'))
        except (TypeError, ValueError):
            duration_val = None
        if not duration_val:
            duration_val = cfg['cutDuration'] if action == 'cut' else cfg['bakeDuration']
        sanitized['duration'] = duration_val
        sanitized_cooking.append(sanitized)
    if not sanitized_cooking:
        sanitized_cooking = default_cooking_recipes()
    cfg['cookingRecipes'] = sanitized_cooking

    sanitized_combination = []
    for recipe in cfg.get('combinationRecipes', []) or []:
        if not isinstance(recipe, dict):
            continue
        inputs = []
        for component in (recipe.get('inputs') or [])[:2]:
            if not isinstance(component, dict):
                break
            inputs.append({
                'type': component.get('type'),
                'state': component.get('state'),
            })
        if len(inputs) != 2:
            continue
        result = recipe.get('result') or {}
        result_type = result.get('type')
        if not result_type:
            continue
        sanitized_combination.append({
            'inputs': inputs,
            'result': {
                'type': result_type,
                'state': result.get('state'),
            },
            'name': recipe.get('name'),
        })
    if not sanitized_combination:
        sanitized_combination = default_combination_recipes()
    cfg['combinationRecipes'] = sanitized_combination

    choices = list(ingredient_list)

    sanitized_generators = []
    for fg in cfg.get('foodGenerators', []):
        cloned = dict(fg)
        cloned.setdefault('width', DEFAULT_GENERATOR['width'])
        cloned.setdefault('height', DEFAULT_GENERATOR['height'])
        cloned.setdefault('x', DEFAULT_GENERATOR['x'])
        cloned.setdefault('y', DEFAULT_GENERATOR['y'])
        if cloned.get('nextFood') not in choices:
            cloned['nextFood'] = random.choice(choices) if choices else None
        sanitized_generators.append(cloned)

    if not sanitized_generators:
        gen = dict(DEFAULT_GENERATOR)
        gen['nextFood'] = random.choice(choices) if choices else None
        sanitized_generators.append(gen)

    cfg['foodGenerators'] = sanitized_generators

    def _sanitize_obstacle(obstacle):
        base = dict(obstacle or {})
        base['x'] = _coerce_float(base.get('x'), 0.0)
        base['y'] = _coerce_float(base.get('y'), 0.0)
        width = _coerce_float(base.get('width'), 96.0)
        height = _coerce_float(base.get('height'), 96.0)
        base['width'] = max(16.0, width if width else 96.0)
        base['height'] = max(16.0, height if height else 96.0)
        return base

    def _sanitize_obstacle_list(values):
        sanitized = []
        for entry in values or []:
            if isinstance(entry, dict):
                sanitized.append(_sanitize_obstacle(entry))
        return sanitized

    cfg['staticObstacles'] = _sanitize_obstacle_list(cfg.get('staticObstacles'))
    cfg['movingObstacles'] = _sanitize_obstacle_list(cfg.get('movingObstacles'))
    cfg.setdefault('transferObjects', [])

    return cfg

# ─────────────────────────────────────────
# ルーム構成ヘルパー
# ─────────────────────────────────────────


def refresh_orders_metadata(rs: RoomState):
    if not isinstance(rs.orders, list):
        rs.orders = []
        return
    cfg = rs.config or {}
    runtime = getattr(rs, 'runtime', {})
    refreshed = []
    for order in rs.orders:
        if isinstance(order, dict):
            refreshed.append(hydrate_order(cfg, runtime, order))
    rs.orders = refreshed


def assign_room_config(rs: RoomState, cfg: dict, revision: Optional[int] = None):
    rs.config = cfg
    rs.runtime = build_runtime_metadata(cfg)
    if revision is not None:
        try:
            rs.configRevision = int(revision)
        except (TypeError, ValueError):
            rs.configRevision = rs.configRevision or 0
    else:
        rs.configRevision += 1
    refresh_orders_metadata(rs)


def _serialize_item(item: Optional[Item]) -> Optional[dict]:
    if not item:
        return None
    return {
        'id': item.id,
        'type': item.type,
        'x': item.x,
        'y': item.y,
        'state': item.state,
        'display': item.display,
    }


def _serialize_player(player: Player) -> dict:
    return {
        'x': player.x,
        'y': player.y,
        'currentItem': _serialize_item(player.currentItem),
        'cooking': player.cooking,
        'currentZone': dict(player.currentZone) if isinstance(player.currentZone, dict) else None,
        'base_image': player.base_image,
        'image': player.image,
    }


def serialize_room_state(rs: RoomState) -> dict:
    return {
        'players': {pid: _serialize_player(p) for pid, p in rs.players.items()},
        'items': [_serialize_item(itm) for itm in rs.items],
        'orders': [dict(order) for order in rs.orders if isinstance(order, dict)],
        'score': rs.score,
        'timer': rs.timer,
        'gameOver': rs.gameOver,
        'config': rs.config,
        'nextItemId': rs.nextItemId,
        'resetScheduled': rs.resetScheduled,
        'hostId': rs.hostId,
        'clientManaged': rs.clientManaged,
        'configRevision': rs.configRevision,
    }

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
        state = serialize_room_state(rooms[room])
        state['serverTime'] = time.time()
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


def _coerce_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _item_from_snapshot(data: dict, fallback_id: int) -> Item:
    item_id = _coerce_int(data.get('id'), fallback_id)
    return Item(
        id=item_id,
        type=str(data.get('type') or ''),
        x=_coerce_float(data.get('x'), 0.0),
        y=_coerce_float(data.get('y'), 0.0),
        state=str(data.get('state') or 'raw'),
        display=data.get('display') or None,
    )


def _ensure_item_lookup(rs: RoomState) -> Dict[int, Item]:
    lookup = getattr(rs, 'item_lookup', None)
    if lookup is None:
        lookup = {}
        rs.item_lookup = lookup
        for itm in rs.items:
            lookup[itm.id] = itm
    return lookup


def _register_world_item(rs: RoomState, item: Item, *, assign_new_id: bool = False) -> Item:
    lookup = _ensure_item_lookup(rs)
    if assign_new_id or item.id is None:
        item.id = rs.nextItemId
        rs.nextItemId += 1
    else:
        if item.id >= rs.nextItemId:
            rs.nextItemId = item.id + 1
    rs.items.append(item)
    lookup[item.id] = item
    return item


def _remove_world_item(rs: RoomState, target) -> Optional[Item]:
    lookup = _ensure_item_lookup(rs)
    item: Optional[Item]
    if isinstance(target, Item):
        item = target
    else:
        try:
            item_id = int(target)
        except (TypeError, ValueError):
            item_id = None
        item = lookup.get(item_id) if item_id is not None else None
    if not item:
        return None
    lookup.pop(item.id, None)
    try:
        rs.items.remove(item)
    except ValueError:
        rs.items[:] = [itm for itm in rs.items if itm.id != item.id]
    return item


def _rebuild_item_lookup(rs: RoomState):
    lookup = _ensure_item_lookup(rs)
    lookup.clear()
    for itm in rs.items:
        lookup[itm.id] = itm


def _clear_world_items(rs: RoomState):
    rs.items.clear()
    lookup = _ensure_item_lookup(rs)
    lookup.clear()


def _apply_client_state(room: str, snapshot: dict):
    rs = rooms[room]
    players = snapshot.get('players') or {}
    new_players: Dict[str, Player] = {}
    for pid, pdata in players.items():
        existing = rs.players.get(pid, Player(base_image=pid, image=pid))
        existing.x = _coerce_float(pdata.get('x'), existing.x)
        existing.y = _coerce_float(pdata.get('y'), existing.y)
        if pdata.get('base_image'):
            existing.base_image = str(pdata.get('base_image'))
        if pdata.get('image'):
            existing.image = str(pdata.get('image'))
        item_payload = pdata.get('currentItem')
        if isinstance(item_payload, dict):
            existing.currentItem = _item_from_snapshot(item_payload, rs.nextItemId)
        else:
            existing.currentItem = None
        new_players[pid] = existing

    rs.players = new_players

    items_payload = snapshot.get('items') or []
    new_items = []
    for item in items_payload:
        if not isinstance(item, dict):
            continue
        new_items.append(_item_from_snapshot(item, rs.nextItemId))
    rs.items = new_items
    _rebuild_item_lookup(rs)

    if snapshot.get('orders') is not None:
        orders = []
        for order in snapshot.get('orders') or []:
            if isinstance(order, dict):
                orders.append(dict(order))
        rs.orders = orders
    rs.score = _coerce_int(snapshot.get('score'), rs.score)
    rs.timer = _coerce_int(snapshot.get('timer'), rs.timer)
    rs.gameOver = bool(snapshot.get('gameOver', rs.gameOver))

    if snapshot.get('nextItemId') is not None:
        rs.nextItemId = _coerce_int(snapshot.get('nextItemId'), rs.nextItemId)
    elif rs.item_lookup:
        rs.nextItemId = max(rs.item_lookup) + 1

    cfg = snapshot.get('config')
    if isinstance(cfg, dict):
        cfg = sanitize_config(cfg)
        if isinstance(cfg.get('transferObjects'), str):
            cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])
        revision = _coerce_int(snapshot.get('configRevision'), rs.configRevision)
        assign_room_config(rs, cfg, revision=revision)

    rs.clientManaged = True


def in_zone(x: float, y: float, zone: dict) -> bool:
    return (
        zone['x'] - zone['width']/2 <= x <= zone['x'] + zone['width']/2 and
        zone['y'] - zone['height']/2 <= y <= zone['y'] + zone['height']/2
    )


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _zone_metrics(zone: dict) -> dict:
    width = max(16.0, _coerce_float(zone.get('width'), 150.0))
    height = max(16.0, _coerce_float(zone.get('height'), 150.0))
    half_w = width / 2.0
    half_h = height / 2.0
    x = _coerce_float(zone.get('x'), 0.0)
    y = _coerce_float(zone.get('y'), 0.0)
    return {
        'x': x,
        'y': y,
        'half_w': half_w,
        'half_h': half_h,
        'left': x - half_w,
        'right': x + half_w,
        'top': y - half_h,
        'bottom': y + half_h,
    }


def _attached_zones(cfg: dict, obstacle: dict) -> list:
    zones = []
    metrics = _obstacle_metrics(obstacle)
    for zone in cfg.get('actionZones') or []:
        if not isinstance(zone, dict):
            continue
        zone_metrics = _zone_metrics(zone)
        if _rectangles_overlap(zone_metrics, metrics):
            zones.append(zone)
    return zones


def _gather_obstacle_entries(cfg: dict) -> list:
    entries = []
    for obstacle in cfg.get('staticObstacles') or []:
        if isinstance(obstacle, dict):
            entries.append({'obstacle': obstacle, 'pushable': False, 'zones': _attached_zones(cfg, obstacle)})
    for obstacle in cfg.get('movingObstacles') or []:
        if isinstance(obstacle, dict):
            entries.append({'obstacle': obstacle, 'pushable': True, 'zones': _attached_zones(cfg, obstacle)})
    return entries


def _obstacle_metrics(obstacle: dict) -> dict:
    width = max(16.0, _coerce_float(obstacle.get('width'), 96.0))
    height = max(16.0, _coerce_float(obstacle.get('height'), 96.0))
    half_w = width / 2
    half_h = height / 2
    x = _coerce_float(obstacle.get('x'), 0.0)
    y = _coerce_float(obstacle.get('y'), 0.0)
    return {
        'x': x,
        'y': y,
        'half_w': half_w,
        'half_h': half_h,
        'left': x - half_w,
        'right': x + half_w,
        'top': y - half_h,
        'bottom': y + half_h,
    }


def _rectangles_overlap(a: dict, b: dict) -> bool:
    return (
        a['left'] < b['right'] - _COLLISION_EPSILON
        and a['right'] > b['left'] + _COLLISION_EPSILON
        and a['top'] < b['bottom'] - _COLLISION_EPSILON
        and a['bottom'] > b['top'] + _COLLISION_EPSILON
    )


def _circle_rect_collision(cx: float, cy: float, radius: float, rect: dict) -> bool:
    closest_x = _clamp(cx, rect['left'], rect['right'])
    closest_y = _clamp(cy, rect['top'], rect['bottom'])
    dx = cx - closest_x
    dy = cy - closest_y
    return dx * dx + dy * dy <= radius * radius


def _try_move_obstacle(entries: list, entry: dict, dx: float, dy: float) -> tuple:
    obstacle = entry['obstacle']
    if abs(dx) < _COLLISION_EPSILON and abs(dy) < _COLLISION_EPSILON:
        return 0.0, 0.0
    metrics = _obstacle_metrics(obstacle)
    target_x = _clamp(metrics['x'] + dx, metrics['half_w'], PLAYFIELD_WIDTH - metrics['half_w'])
    target_y = _clamp(metrics['y'] + dy, metrics['half_h'], PLAYFIELD_HEIGHT - metrics['half_h'])
    actual_dx = target_x - metrics['x']
    actual_dy = target_y - metrics['y']
    new_rect = {
        'left': target_x - metrics['half_w'],
        'right': target_x + metrics['half_w'],
        'top': target_y - metrics['half_h'],
        'bottom': target_y + metrics['half_h'],
    }
    for other_entry in entries:
        other = other_entry['obstacle']
        if other is obstacle:
            continue
        other_metrics = _obstacle_metrics(other)
        if _rectangles_overlap(new_rect, other_metrics):
            return 0.0, 0.0
    obstacle['x'] = target_x
    obstacle['y'] = target_y
    if abs(actual_dx) > _COLLISION_EPSILON or abs(actual_dy) > _COLLISION_EPSILON:
        for zone in entry.get('zones') or []:
            prev_x = _coerce_float(zone.get('x'), metrics['x'])
            prev_y = _coerce_float(zone.get('y'), metrics['y'])
            zone['x'] = prev_x + actual_dx
            zone['y'] = prev_y + actual_dy
    return actual_dx, actual_dy


def _resolve_axis(entries: list, current_x: float, current_y: float, target_value: float, axis: str) -> tuple:
    candidate = target_value
    moved_obstacles = False
    start = current_x if axis == 'x' else current_y
    delta = candidate - start
    if abs(delta) < _COLLISION_EPSILON:
        return start, False

    for entry in entries:
        pushable = entry['pushable']
        obstacle = entry['obstacle']
        metrics = _obstacle_metrics(obstacle)
        circle_x = candidate if axis == 'x' else current_x
        circle_y = candidate if axis == 'y' else current_y
        if not _circle_rect_collision(circle_x, circle_y, PLAYER_RADIUS, metrics):
            continue

        if delta > 0:
            limit = metrics['left'] - PLAYER_RADIUS
            if candidate <= limit + _COLLISION_EPSILON:
                continue
            if pushable:
                desired = candidate - limit
                move_dx, move_dy = _try_move_obstacle(
                    entries,
                    entry,
                    desired if axis == 'x' else 0.0,
                    desired if axis == 'y' else 0.0,
                )
                if (axis == 'x' and abs(move_dx) > _COLLISION_EPSILON) or (
                    axis == 'y' and abs(move_dy) > _COLLISION_EPSILON
                ):
                    moved_obstacles = True
                metrics = _obstacle_metrics(obstacle)
                limit = metrics['left'] - PLAYER_RADIUS
            candidate = min(candidate, limit)
        else:
            limit = metrics['right'] + PLAYER_RADIUS
            if candidate >= limit - _COLLISION_EPSILON:
                continue
            if pushable:
                desired = candidate - limit
                move_dx, move_dy = _try_move_obstacle(
                    entries,
                    entry,
                    desired if axis == 'x' else 0.0,
                    desired if axis == 'y' else 0.0,
                )
                if (axis == 'x' and abs(move_dx) > _COLLISION_EPSILON) or (
                    axis == 'y' and abs(move_dy) > _COLLISION_EPSILON
                ):
                    moved_obstacles = True
                metrics = _obstacle_metrics(obstacle)
                limit = metrics['right'] + PLAYER_RADIUS
            candidate = max(candidate, limit)

    if axis == 'x':
        candidate = _clamp(candidate, PLAYER_RADIUS, PLAYFIELD_WIDTH - PLAYER_RADIUS)
    else:
        candidate = _clamp(candidate, PLAYER_RADIUS, PLAYFIELD_HEIGHT - PLAYER_RADIUS)

    return candidate, moved_obstacles


def apply_player_move(state: RoomState, player: Player, target_x: float, target_y: float) -> tuple:
    if player is None:
        return False, False

    if not (isinstance(target_x, (int, float)) and isinstance(target_y, (int, float))):
        return False, False

    cfg = state.config or {}
    entries = _gather_obstacle_entries(cfg)

    start_x = player.x
    start_y = player.y

    clamped_x = _clamp(target_x, PLAYER_RADIUS, PLAYFIELD_WIDTH - PLAYER_RADIUS)
    clamped_y = _clamp(target_y, PLAYER_RADIUS, PLAYFIELD_HEIGHT - PLAYER_RADIUS)

    obstacles_moved = False

    if entries:
        resolved_x, moved_x = _resolve_axis(entries, start_x, start_y, clamped_x, 'x')
        obstacles_moved = obstacles_moved or moved_x
        resolved_y, moved_y = _resolve_axis(entries, resolved_x, start_y, clamped_y, 'y')
        obstacles_moved = obstacles_moved or moved_y
    else:
        resolved_x = clamped_x
        resolved_y = clamped_y

    moved = abs(resolved_x - start_x) > _COLLISION_EPSILON or abs(resolved_y - start_y) > _COLLISION_EPSILON

    if moved:
        player.x = resolved_x
        player.y = resolved_y
        if player.currentItem:
            player.currentItem.x = resolved_x
            player.currentItem.y = resolved_y

    return moved, obstacles_moved


def initialize_room(room: str, config: dict = None):
    cfg = sanitize_config(config or get_default_config())
    if isinstance(cfg.get('transferObjects'), str):
        cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])

    rs = RoomState()
    assign_room_config(rs, cfg)
    rs.timer = cfg.get('gameTime', rs.timer)
    rs.orders = [build_order(cfg, rs.runtime) for _ in range(3)]

    item_choices = ingredient_types()
    for _ in range(3):
        if not item_choices:
            break
        item_type = random.choice(item_choices)
        state = default_item_state(item_type)
        itm = Item(
            id=0,
            type=item_type,
            x=random.randint(50,750),
            y=random.randint(50,550),
            state=state,
            display=format_item_display(item_type, state),
        )
        _register_world_item(rs, itm, assign_new_id=True)

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
    return jsonify({r: serialize_room_state(rs) for r, rs in rooms.items()})

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
    rs.orders = [build_order(cfg, rs.runtime) for _ in range(3)]
    rs.resetScheduled = False
    refresh_orders_metadata(rs)
    mark_dirty(room)
    return "Reset", 200

# ─────────────────────────────────────────
# SocketIO イベント
# ─────────────────────────────────────────
def run_cooking_task(room: str, zone: dict, task: dict):
    if room not in rooms or rooms[room].clientManaged:
        return

    duration = max(float(task.get('duration', 1.0) or 0.0), 0.1)
    result_type = task.get('result_type')
    result_state = task.get('result_state')
    burn_enabled = (
        result_type == 'ingredient_beef_patty'
        and (result_state is None or result_state == 'cooked')
    )
    burn_threshold = duration * 4.0 if burn_enabled else None
    start = time.time()
    task['startedAt'] = start
    task['duration'] = duration

    result_item_id = None
    burned = False
    burn_display_at: Optional[float] = None

    while True:
        socketio.sleep(0.1)
        if room not in rooms:
            return

        rs = rooms[room]
        current = zone.get('cooking')
        if not current or current.get('id') != task['id']:
            return

        now = time.time()
        elapsed = now - start
        progress = max(0.0, min(elapsed / duration, 1.0))
        dirty = False

        if abs(current.get('progress', 0.0) - progress) > 1e-4:
            current['progress'] = progress
            dirty = True
        if abs(current.get('elapsed', 0.0) - elapsed) > 1e-4:
            current['elapsed'] = elapsed
            dirty = True

        remaining = 0.0 if result_item_id is not None else max(duration - elapsed, 0.0)
        if abs(current.get('remaining', 0.0) - remaining) > 1e-4:
            current['remaining'] = remaining
            dirty = True

        if result_item_id is None and progress >= 1.0:
            cooked = Item(
                id=0,
                type=task['result_type'],
                x=zone['x'],
                y=zone['y'],
                state=task['result_state'],
            )
            display = task.get('result_display') or format_item_display(
                task['result_type'], task['result_state']
            )
            cooked.display = display
            _register_world_item(rs, cooked, assign_new_id=True)

            result_item_id = cooked.id
            current['result_item_id'] = result_item_id
            current['finishedAt'] = now
            current['displayText'] = display
            zone['occupied'] = False
            dirty = True

        if result_item_id is not None and not burned:
            if result_item_id not in rs.item_lookup:
                if zone.get('cooking', {}).get('id') == task['id']:
                    zone.pop('cooking', None)
                    mark_dirty(room)
                return

            if burn_threshold and burn_threshold > 0.0 and elapsed >= burn_threshold:
                removed = _remove_world_item(rs, result_item_id)
                if removed:
                    current['displayText'] = '消し炭になってしまった！'
                    current['progress'] = 0.0
                    current['remaining'] = 0.0
                    current['burned'] = True
                    current['burnedAt'] = now
                    burned = True
                    burn_display_at = now
                    dirty = True

        if burned:
            if burn_display_at and (now - burn_display_at) >= 1.5:
                if zone.get('cooking', {}).get('id') == task['id']:
                    zone.pop('cooking', None)
                mark_dirty(room)
                return

        if dirty:
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
    is_host = False
    if not rs.hostId:
        rs.hostId = pid
        rs.clientManaged = True
        is_host = True
    mark_dirty(room)
    return {'playerId': pid, 'isHost': is_host, 'clientManaged': rs.clientManaged}

@socketio.on('disconnect')
def on_disconnect():
    info = sid_to_player.pop(request.sid, None)
    if not info:
        return
    room, pid = info
    if room in rooms and pid in rooms[room].players:
        rooms[room].players.pop(pid)
        rs = rooms[room]
        if rs.hostId == pid:
            rs.hostId = ''
            rs.clientManaged = False
        mark_dirty(room)

@socketio.on('update_config')
def on_update_config(data):
    room, cfg = data.get('room'), data.get('config')
    if room not in rooms:
        initialize_room(room, cfg)
    else:
        cfg = sanitize_config(cfg)
        if isinstance(cfg.get('transferObjects'), str):
            cfg['transferObjects'] = parse_transfer_objects(cfg['transferObjects'])
        assign_room_config(rooms[room], cfg)
        mark_dirty(room)

@socketio.on('move')
def on_move(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in rooms or pid not in rooms[room].players:
        return
    rs = rooms[room]
    p = rs.players[pid]
    try:
        nx = float(data.get('x'))
        ny = float(data.get('y'))
    except (TypeError, ValueError):
        return

    moved, obstacles_moved = apply_player_move(rs, p, nx, ny)
    if rs.clientManaged:
        socketio.emit('client_move', {
            'playerId': pid,
            'room': room,
            'x': p.x,
            'y': p.y,
        }, room=room)
    if moved or obstacles_moved:
        mark_dirty(room)

@socketio.on('interact')
def on_interact(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in rooms or pid not in rooms[room].players:
        return
    rs, p = rooms[room], rooms[room].players[pid]
    if rs.clientManaged:
        payload = {
            'playerId': pid,
            'room': room,
            'x': data.get('x'),
            'y': data.get('y'),
        }
        socketio.emit('client_interact', payload, room=room)
        return
    cfg = rs.config
    runtime = getattr(rs, 'runtime', {})

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
            moved, obstacles_moved = apply_player_move(rs, p, nx, ny)
            x, y = p.x, p.y
            position_updated = moved or obstacles_moved

    # アイテム取得 or 生成
    if p.currentItem is None:
        pickup_radius_sq = 50 * 50
        for itm in list(rs.items):
            dx = itm.x - x
            dy = itm.y - y
            if dx * dx + dy * dy < pickup_radius_sq:
                p.currentItem = itm
                _remove_world_item(rs, itm)
                mark_dirty(room)
                return
        food_choices = ingredient_types()
        for fg in cfg.get('foodGenerators', []):
            if not in_zone(x, y, fg):
                continue
            if not food_choices:
                continue
            next_type = fg.get('nextFood') if fg.get('nextFood') in food_choices else random.choice(food_choices)
            state = default_item_state(next_type)
            new_itm = Item(
                id=rs.nextItemId,
                type=next_type,
                x=x,
                y=y,
                state=state,
                display=format_item_display(next_type, state),
            )
            rs.nextItemId += 1
            p.currentItem = new_itm
            if food_choices:
                fg['nextFood'] = random.choice(food_choices)
            mark_dirty(room)
            return
        if position_updated:
            mark_dirty(room)
        return

    # 調理ステップ
    itm = p.currentItem
    action_needed = None
    result_state = itm.state
    result_type = itm.type
    duration = None
    display_override = None
    recipe = find_cooking_recipe(runtime.get('cooking_lookup'), itm.type, itm.state)
    if not recipe:
        for candidate in cfg.get('cookingRecipes', []) or []:
            if not isinstance(candidate, dict):
                continue
            if candidate.get('type') != itm.type:
                continue
            from_state = candidate.get('from')
            if from_state and from_state != itm.state:
                continue
            action = candidate.get('action')
            if not action:
                continue
            to_state = candidate.get('to', itm.state)
            if to_state is None:
                continue
            recipe = candidate
            break

    if recipe:
        action_needed = recipe.get('action')
        result_state = recipe.get('to', itm.state)
        if result_state is None:
            result_state = itm.state
        result_type = recipe.get('resultType', itm.type)
        duration = recipe.get('duration')
        display_override = recipe.get('display')

    if action_needed:
        for zone in cfg.get('actionZones', []):
            if zone.get('action') != action_needed or zone.get('occupied'):
                continue
            if not in_zone(x, y, zone):
                continue
            zone['occupied'] = True
            p.currentItem = None
            p.cooking = False
            p.currentZone = None
            p.image = p.base_image

            try:
                duration_val = float(duration or 0)
            except (TypeError, ValueError):
                duration_val = cfg['cutDuration'] if action_needed == 'cut' else cfg['bakeDuration']
            if duration_val <= 0:
                duration_val = cfg['cutDuration'] if action_needed == 'cut' else cfg['bakeDuration']

            cooking_id = uuid.uuid4().hex
            display_text = display_override or zone.get('display') or (
                '切っている…' if action_needed == 'cut' else '焼いている…'
            )
            task = {
                'id': cooking_id,
                'progress': 0.0,
                'duration': duration_val,
                'texture': getattr(itm, 'type', None),
                'itemType': getattr(itm, 'type', None),
                'displayText': display_text,
                'result_type': result_type,
                'result_state': result_state,
                'result_display': format_item_display(result_type, result_state),
                'startedAt': time.time(),
            }
            zone['cooking'] = task

            socketio.start_background_task(
                run_cooking_task, room, zone, task
            )
            mark_dirty(room)
            return

    # 組み合わせ
    stack_tolerance = PLAYER_RADIUS + 8
    for other in rs.items:
        if other is itm:
            continue
        dx = other.x - x
        dy = other.y - y
        if abs(dx) > stack_tolerance or abs(dy) > stack_tolerance:
            continue
        recipe = find_combination_recipe_from_index(
            runtime.get('combination_index'),
            itm.type,
            itm.state,
            other.type,
            other.state,
        )
        if not recipe:
            recipe = find_combination_recipe(
                cfg.get('combinationRecipes'),
                itm.type,
                itm.state,
                other.type,
                other.state,
            )
        if not recipe:
            continue
        result = recipe.get('result') or {}
        result_type = result.get('type')
        if not result_type:
            continue
        result_state = result.get('state') or default_item_state(result_type)
        other.type = result_type
        other.state = result_state
        other.display = format_item_display(result_type, result_state)
        p.currentItem = None
        mark_dirty(room)
        return

    # 配膳
    delivery_zone = cfg.get('deliveryZone')
    if delivery_zone and in_zone(x, y, delivery_zone):
        mapping = cfg.get('orderMapping', {})
        delivered = mapping.get(itm.type)
        if not delivered:
            if position_updated:
                mark_dirty(room)
            return
        expected_state = None
        if itm.type.startswith('dish_'):
            expected_state = default_item_state(itm.type)
        else:
            expected_state = 'cooked'
        if expected_state and itm.state != expected_state:
            if position_updated:
                mark_dirty(room)
            return
        expected = rs.orders[0]['dish'] if rs.orders else None
        if delivered == expected:
            rs.score += 10
            rs.orders.pop(0)
            rs.orders.append(build_order(cfg, rs.runtime))
        else:
            rs.score -= cfg.get('wrongOrderPenalty', 5)
        p.currentItem = None
        mark_dirty(room)
        return

    # 置く or 転送
    itm.x, itm.y = x, y
    itm.display = format_item_display(itm.type, itm.state)
    for tr in cfg.get('transferObjects', []):
        src = tr.get('sourceZone')
        dest = tr.get('destination')
        if not src or not dest:
            continue
        if in_zone(x, y, src):
            itm.x = dest.get('x', itm.x)
            itm.y = dest.get('y', itm.y)
            break
    _register_world_item(rs, itm, assign_new_id=True)
    p.currentItem = None
    mark_dirty(room)


@socketio.on('client_state')
def on_client_state(data):
    room, pid = data.get('room'), data.get('playerId')
    if room not in rooms or pid not in rooms[room].players:
        return
    rs = rooms[room]
    if rs.hostId and rs.hostId != pid:
        return
    snapshot = data.get('state')
    if not isinstance(snapshot, dict):
        return
    if not rs.hostId:
        rs.hostId = pid
    _apply_client_state(room, snapshot)
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
            if rs.clientManaged:
                continue
            if rs.timer > 0:
                rs.timer -= 1
                if rs.timer <= 0:
                    rs.gameOver = True
                    _clear_world_items(rs)
            update_orders(room, rooms)
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
