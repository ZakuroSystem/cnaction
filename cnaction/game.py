"""Game state management utilities used by the Flask views and sockets."""
from __future__ import annotations

import random
import time
import uuid
from threading import Lock, RLock
from typing import Dict, Optional, Tuple

from flask_socketio import SocketIO

from models import Item, Player, RoomState
from utils import (
    build_order,
    build_runtime_metadata,
    default_item_state,
    get_default_config,
    find_combination_recipe,
    find_combination_recipe_from_index,
    format_item_display,
    hydrate_order,
    ingredient_types,
    parse_transfer_objects,
)

from .config import sanitize_config
from .constants import (
    COLLISION_EPSILON,
    DEFAULT_BAKE_DURATION,
    DEFAULT_CUT_DURATION,
    PLAYER_RADIUS,
    PLAYFIELD_HEIGHT,
    PLAYFIELD_WIDTH,
)
from .values import coerce_float, coerce_int, normalize_uuid_list


rooms: Dict[str, RoomState] = {}
dirty_flags: Dict[str, bool] = {}
sid_to_player: Dict[str, Tuple[str, str]] = {}

_socketio: Optional[SocketIO] = None
_flush_lock = Lock()
_flush_pending = False


def init(socketio: SocketIO) -> None:
    """Configure the game state module with the active SocketIO instance."""
    global _socketio
    _socketio = socketio


def _require_socketio() -> SocketIO:
    if _socketio is None:
        raise RuntimeError('SocketIO instance has not been initialised.')
    return _socketio


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
    with _room_lock(rs):
        rs.config = cfg
        rs.runtime = build_runtime_metadata(cfg)
        registry = _ensure_cooking_registry(rs)
        registry.clear()
        for zone in cfg.get('actionZones') or []:
            if not isinstance(zone, dict):
                continue
            cooking = zone.get('cooking')
            zone['occupied'] = bool(cooking)
            if isinstance(cooking, dict) and cooking.get('id'):
                registry[cooking['id']] = {'zone': zone, 'task': cooking}
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
        'uuids': list(getattr(item, 'uuids', []) or []),
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
    with _room_lock(rs):
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


def _room_lock(rs: RoomState) -> RLock:
    lock = getattr(rs, 'lock', None)
    if lock is None:
        lock = RLock()
        rs.lock = lock
    return lock


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
        _require_socketio().emit('state_update', state, room=room)
        dirty_flags.pop(room, None)


def schedule_flush(delay: float = 1 / 30):
    global _flush_pending
    with _flush_lock:
        if _flush_pending:
            return
        _flush_pending = True

    sio = _require_socketio()

    def runner():
        global _flush_pending
        try:
            sio.sleep(delay)
            flush_dirty()
        finally:
            with _flush_lock:
                _flush_pending = False

    sio.start_background_task(runner)


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


def _normalize_uuid_list(raw) -> list:
    if isinstance(raw, str):
        raw = [raw]
    uuids = []
    if isinstance(raw, (list, tuple, set)):
        for value in raw:
            if isinstance(value, str):
                value = value.strip()
            if not value:
                continue
            if not isinstance(value, str):
                continue
            if value in uuids:
                continue
            uuids.append(value)
    return uuids


def _normalize_item_uuids(item: Item) -> list:
    uuids = _normalize_uuid_list(getattr(item, 'uuids', None))
    item.uuids = uuids
    return uuids


def _item_from_snapshot(data: dict, fallback_id: int) -> Item:
    item_id = _coerce_int(data.get('id'), fallback_id)
    return Item(
        id=item_id,
        type=str(data.get('type') or ''),
        x=_coerce_float(data.get('x'), 0.0),
        y=_coerce_float(data.get('y'), 0.0),
        state=str(data.get('state') or 'raw'),
        display=data.get('display') or None,
        uuids=_normalize_uuid_list(data.get('uuids')),
    )


def _ensure_item_lookup(rs: RoomState) -> Dict[int, Item]:
    with _room_lock(rs):
        lookup = getattr(rs, 'item_lookup', None)
        if lookup is None:
            lookup = {}
            rs.item_lookup = lookup
            for itm in rs.items:
                lookup[itm.id] = itm
        return lookup


def _ensure_uuid_lookup(rs: RoomState) -> Dict[str, Item]:
    with _room_lock(rs):
        lookup = getattr(rs, 'uuid_lookup', None)
        if lookup is None:
            lookup = {}
            rs.uuid_lookup = lookup
        return lookup


def _register_item_uuids(rs: RoomState, item: Optional[Item]) -> bool:
    if not item:
        return True
    uuids = _normalize_item_uuids(item)
    if not uuids:
        return True
    with _room_lock(rs):
        lookup = _ensure_uuid_lookup(rs)
        # Remove stale mappings for this item that are no longer present.
        for key, existing in list(lookup.items()):
            if existing is item and key not in uuids:
                lookup.pop(key, None)
        for uid in uuids:
            existing = lookup.get(uid)
            if existing is not None and existing is not item:
                return False
        for uid in uuids:
            lookup[uid] = item
    return True


def _unregister_item_uuids(rs: RoomState, item: Optional[Item]):
    if not item:
        return
    with _room_lock(rs):
        lookup = _ensure_uuid_lookup(rs)
        for key, existing in list(lookup.items()):
            if existing is item:
                lookup.pop(key, None)


def _rebuild_item_uuid_lookup(rs: RoomState):
    with _room_lock(rs):
        lookup = _ensure_uuid_lookup(rs)
        lookup.clear()
        for player in rs.players.values():
            if not isinstance(player, Player):
                continue
            itm = getattr(player, 'currentItem', None)
            if itm:
                _register_item_uuids(rs, itm)
        for itm in rs.items:
            _register_item_uuids(rs, itm)


def _clear_item_uuid_lookup(rs: RoomState):
    lookup = _ensure_uuid_lookup(rs)
    lookup.clear()


def _ensure_cooking_registry(rs: RoomState) -> Dict[str, dict]:
    with _room_lock(rs):
        registry = getattr(rs, 'cooking_tasks', None)
        if registry is None:
            registry = {}
            rs.cooking_tasks = registry
        return registry


def _settlement_is_open(settlement) -> bool:
    if not isinstance(settlement, dict):
        return False
    status = settlement.get('status')
    if status in ('captured', 'voided'):
        return False
    return True


def _track_cooking_task(rs: RoomState, zone: dict, task: dict):
    with _room_lock(rs):
        registry = _ensure_cooking_registry(rs)
        registry[task.get('id')] = {'zone': zone, 'task': task}


def _untrack_cooking_task(rs: RoomState, task_id):
    if not task_id:
        return
    with _room_lock(rs):
        registry = _ensure_cooking_registry(rs)
        registry.pop(task_id, None)


def _clear_zone_cooking(rs: RoomState, zone: dict) -> bool:
    if not isinstance(zone, dict):
        return False
    with _room_lock(rs):
        cooking = zone.pop('cooking', None)
        zone['occupied'] = False
        if not cooking:
            return False
        _untrack_cooking_task(rs, cooking.get('id'))
        return True


def _register_world_item(rs: RoomState, item: Item, *, assign_new_id: bool = False) -> Optional[Item]:
    with _room_lock(rs):
        lookup = _ensure_item_lookup(rs)
        if assign_new_id or item.id is None:
            item.id = rs.nextItemId
            rs.nextItemId += 1
        else:
            if item.id >= rs.nextItemId:
                rs.nextItemId = item.id + 1
        if not _register_item_uuids(rs, item):
            return None
        rs.items.append(item)
        lookup[item.id] = item
        return item


def _remove_world_item(
    rs: RoomState,
    target,
    *,
    clear_cooking: bool = False,
    room: Optional[str] = None,
) -> Optional[Item]:
    with _room_lock(rs):
        lookup = _ensure_item_lookup(rs)
        item: Optional[Item]
        item_id: Optional[int]
        if isinstance(target, Item):
            item = target
            item_id = getattr(item, 'id', None)
        else:
            try:
                item_id = int(target)
            except (TypeError, ValueError):
                item_id = None
            item = lookup.get(item_id) if item_id is not None else None
        if not item:
            if clear_cooking and item_id is not None:
                cleared = _clear_cooking_task_for_item(rs, item_id)
                if cleared and room:
                    mark_dirty(room)
            return None
        lookup.pop(item.id, None)
        try:
            rs.items.remove(item)
        except ValueError:
            rs.items[:] = [itm for itm in rs.items if itm.id != item.id]
        if clear_cooking:
            cleared = _clear_cooking_task_for_item(
                rs,
                getattr(item, 'id', None),
                getattr(item, 'type', None),
                getattr(item, 'state', None),
            )
            if cleared and room:
                mark_dirty(room)
        return item


def _clear_cooking_task_for_item(
    rs: RoomState,
    item_id: Optional[int],
    item_type: Optional[str] = None,
    item_state: Optional[str] = None,
) -> bool:
    if not isinstance(item_id, int) and not item_type:
        return False

    def _task_matches(task: dict) -> bool:
        if not isinstance(task, dict):
            return False
        raw_result_id = task.get('result_item_id')
        if raw_result_id is None:
            raw_result_id = task.get('resultItemId')
        try:
            result_id = int(raw_result_id)
        except (TypeError, ValueError):
            result_id = None
        if isinstance(item_id, int) and isinstance(result_id, int) and result_id == item_id:
            return True
        result_type = task.get('result_type') or task.get('resultType')
        if result_type and item_type and result_type == item_type:
            result_state = task.get('result_state')
            if result_state is None:
                result_state = task.get('resultState')
            if result_state is None or result_state == item_state:
                progress = task.get('progress')
                finished_at = task.get('finishedAt')
                if progress is None or progress >= 1.0 or finished_at:
                    return True
        return False

    with _room_lock(rs):
        cleared = False
        registry = _ensure_cooking_registry(rs)
        for entry in list(registry.values()):
            zone = entry.get('zone') if isinstance(entry, dict) else None
            task = entry.get('task') if isinstance(entry, dict) else None
            if not isinstance(zone, dict) or not _task_matches(task):
                continue
            if _clear_zone_cooking(rs, zone):
                cleared = True

        if cleared:
            return True

        zones = rs.config.get('actionZones') if isinstance(rs.config, dict) else None
        if not zones:
            return False
        for zone in zones:
            if not isinstance(zone, dict):
                continue
            cooking = zone.get('cooking')
            if not cooking or not _task_matches(cooking):
                continue
            if _clear_zone_cooking(rs, zone):
                cleared = True
        return cleared


def _rebuild_item_lookup(rs: RoomState):
    with _room_lock(rs):
        lookup = _ensure_item_lookup(rs)
        lookup.clear()
        for itm in rs.items:
            lookup[itm.id] = itm


def clear_world_items(rs: RoomState):
    with _room_lock(rs):
        rs.items.clear()
        lookup = _ensure_item_lookup(rs)
        lookup.clear()
        _clear_item_uuid_lookup(rs)
        for player in rs.players.values():
            if isinstance(player, Player) and player.currentItem:
                _register_item_uuids(rs, player.currentItem)


def apply_client_state(room: str, snapshot: dict):
    rs = rooms[room]
    with _room_lock(rs):
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
        _rebuild_item_uuid_lookup(rs)

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
        a['left'] < b['right'] - COLLISION_EPSILON
        and a['right'] > b['left'] + COLLISION_EPSILON
        and a['top'] < b['bottom'] - COLLISION_EPSILON
        and a['bottom'] > b['top'] + COLLISION_EPSILON
    )


def _circle_rect_collision(cx: float, cy: float, radius: float, rect: dict) -> bool:
    closest_x = _clamp(cx, rect['left'], rect['right'])
    closest_y = _clamp(cy, rect['top'], rect['bottom'])
    dx = cx - closest_x
    dy = cy - closest_y
    return dx * dx + dy * dy <= radius * radius


def _try_move_obstacle(entries: list, entry: dict, dx: float, dy: float) -> tuple:
    obstacle = entry['obstacle']
    if abs(dx) < COLLISION_EPSILON and abs(dy) < COLLISION_EPSILON:
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
    if abs(actual_dx) > COLLISION_EPSILON or abs(actual_dy) > COLLISION_EPSILON:
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
    if abs(delta) < COLLISION_EPSILON:
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
            if candidate <= limit + COLLISION_EPSILON:
                continue
            if pushable:
                desired = candidate - limit
                move_dx, move_dy = _try_move_obstacle(
                    entries,
                    entry,
                    desired if axis == 'x' else 0.0,
                    desired if axis == 'y' else 0.0,
                )
                if (axis == 'x' and abs(move_dx) > COLLISION_EPSILON) or (
                    axis == 'y' and abs(move_dy) > COLLISION_EPSILON
                ):
                    moved_obstacles = True
                metrics = _obstacle_metrics(obstacle)
                limit = metrics['left'] - PLAYER_RADIUS
            candidate = min(candidate, limit)
        else:
            limit = metrics['right'] + PLAYER_RADIUS
            if candidate >= limit - COLLISION_EPSILON:
                continue
            if pushable:
                desired = candidate - limit
                move_dx, move_dy = _try_move_obstacle(
                    entries,
                    entry,
                    desired if axis == 'x' else 0.0,
                    desired if axis == 'y' else 0.0,
                )
                if (axis == 'x' and abs(move_dx) > COLLISION_EPSILON) or (
                    axis == 'y' and abs(move_dy) > COLLISION_EPSILON
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

    moved = abs(resolved_x - start_x) > COLLISION_EPSILON or abs(resolved_y - start_y) > COLLISION_EPSILON

    if moved:
        player.x = resolved_x
        player.y = resolved_y
        if player.currentItem:
            player.currentItem.x = resolved_x
            player.currentItem.y = resolved_y

    return moved, obstacles_moved


def resolve_cooking_action(rs: RoomState, item: Optional[Item]) -> Optional[dict]:
    if not item:
        return None
    cfg = rs.config or {}
    runtime = getattr(rs, 'runtime', {})
    recipe = find_cooking_recipe(runtime.get('cooking_lookup'), item.type, item.state)
    if not recipe:
        recipes = cfg.get('cookingRecipes') or default_cooking_recipes()
        for candidate in recipes or []:
            if not isinstance(candidate, dict) or candidate.get('type') != item.type:
                continue
            from_state = candidate.get('from')
            if from_state and from_state != item.state:
                continue
            action = candidate.get('action')
            result_state = candidate.get('to', item.state)
            if not action or result_state is None:
                continue
            recipe = candidate
            break
    if not recipe:
        return None
    action_needed = recipe.get('action')
    result_state = recipe.get('to', item.state)
    if not action_needed or result_state is None:
        return None
    result_type = recipe.get('resultType', item.type)
    if result_type is None:
        result_type = item.type
    if action_needed == 'cut':
        default_duration = cfg.get('cutDuration', DEFAULT_CUT_DURATION)
    else:
        default_duration = cfg.get('bakeDuration', DEFAULT_BAKE_DURATION)
    try:
        duration = float(recipe.get('duration'))
    except (TypeError, ValueError):
        duration = None
    if not duration or duration <= 0:
        try:
            duration = float(default_duration)
        except (TypeError, ValueError):
            duration = DEFAULT_CUT_DURATION if action_needed == 'cut' else DEFAULT_BAKE_DURATION
    return {
        'action': action_needed,
        'result_state': result_state if result_state is not None else item.state,
        'result_type': result_type,
        'duration': max(duration, 0.1),
        'display': recipe.get('display'),
    }


def release_cooking_task_for_item(rs: RoomState, room: Optional[str], item: Optional[Item]) -> bool:
    if not item:
        return False
    item_id = getattr(item, 'id', None)
    if not isinstance(item_id, int):
        item_id = None
    cleared = _clear_cooking_task_for_item(
        rs,
        item_id,
        getattr(item, 'type', None),
        getattr(item, 'state', None),
    )
    if cleared and room:
        mark_dirty(room)
    return cleared


def try_pickup_world_item(rs: RoomState, room: str, player: Player, x: float, y: float) -> bool:
    pickup_radius_sq = 50 * 50
    with _room_lock(rs):
        for itm in list(rs.items):
            dx = itm.x - x
            dy = itm.y - y
            if dx * dx + dy * dy >= pickup_radius_sq:
                continue
            removed = _remove_world_item(rs, itm, clear_cooking=True, room=room)
            if not removed:
                continue
            player.currentItem = removed
            return True
    return False


def try_spawn_from_generator(rs: RoomState, player: Player, x: float, y: float) -> bool:
    cfg = rs.config or {}
    generators = cfg.get('foodGenerators', [])
    if not generators:
        return False
    food_choices = ingredient_types()
    if not food_choices:
        return False
    with _room_lock(rs):
        for fg in generators:
            if not in_zone(x, y, fg):
                continue
            next_type = (
                fg.get('nextFood') if fg.get('nextFood') in food_choices else random.choice(food_choices)
            )
            if not next_type:
                continue
            state = default_item_state(next_type)
            new_itm = Item(
                id=rs.nextItemId,
                type=next_type,
                x=x,
                y=y,
                state=state,
                display=format_item_display(next_type, state),
                uuids=[uuid.uuid4().hex],
            )
            rs.nextItemId += 1
            if not _register_item_uuids(rs, new_itm):
                continue
            player.currentItem = new_itm
            fg['nextFood'] = random.choice(food_choices) if food_choices else next_type
            return True
    return False


def start_cooking_action(
    room: str,
    rs: RoomState,
    player: Player,
    x: float,
    y: float,
    item: Item,
    action: dict,
) -> bool:
    if not action:
        return False
    cfg = rs.config or {}
    zones = cfg.get('actionZones', [])
    for zone in zones:
        with _room_lock(rs):
            if zone.get('action') != action['action']:
                continue
            existing_task = zone.get('cooking') if isinstance(zone, dict) else None
            if isinstance(existing_task, dict) and _settlement_is_open(existing_task.get('settlement')):
                zone['occupied'] = True
                continue
            if zone.get('occupied'):
                continue
            if not in_zone(x, y, zone):
                continue
            zone['occupied'] = True
            source_item = _serialize_item(item)
            _unregister_item_uuids(rs, item)
            player.currentItem = None
            player.cooking = False
            player.currentZone = None
            player.image = player.base_image
            duration_val = action.get('duration') or (
                cfg['cutDuration'] if action['action'] == 'cut' else cfg['bakeDuration']
            )
            try:
                duration_val = float(duration_val)
            except (TypeError, ValueError):
                duration_val = (
                    DEFAULT_CUT_DURATION if action['action'] == 'cut' else DEFAULT_BAKE_DURATION
                )
            duration_val = max(duration_val, 0.1)
            texture_key = f"{item.type}:{item.state}" if item.type and item.state else item.type
            result_type = action.get('result_type') or action.get('resultType') or item.type
            result_state = action.get('result_state') or action.get('resultState') or item.state
            result_display = format_item_display(result_type, result_state)
            settlement = {
                'id': uuid.uuid4().hex,
                'status': 'pending',
                'createdAt': time.time(),
                'sourceItemId': source_item.get('id') if isinstance(source_item, dict) else None,
            }
            task = {
                'id': uuid.uuid4().hex,
                'progress': 0.0,
                'duration': duration_val,
                'texture': texture_key,
                'itemType': getattr(item, 'type', None),
                'item_state': getattr(item, 'state', None),
                'displayText': action.get('display')
                or zone.get('display')
                or ('切っている…' if action['action'] == 'cut' else '焼いている…'),
                'result_type': result_type,
                'result_state': result_state,
                'result_display': result_display,
                'startedAt': time.time(),
                'source_item': source_item,
                'settlement': settlement,
            }
            zone['cooking'] = task
            _track_cooking_task(rs, zone, task)
        _require_socketio().start_background_task(run_cooking_task, room, zone, task)
        return True
    return False


def try_deliver_item(rs: RoomState, player: Player, x: float, y: float) -> bool:
    item = player.currentItem
    if not item:
        return False
    cfg = rs.config or {}
    delivery_zone = cfg.get('deliveryZone')
    if not delivery_zone or not in_zone(x, y, delivery_zone):
        return False
    mapping = cfg.get('orderMapping', {})
    delivered = mapping.get(item.type)
    if not delivered:
        return False
    with _room_lock(rs):
        if item.type.startswith('dish_'):
            expected_state = default_item_state(item.type)
        else:
            expected_state = 'cooked'
        if expected_state and item.state != expected_state:
            return False
        expected = rs.orders[0]['dish'] if rs.orders else None
        if delivered == expected:
            rs.score += 10
            if rs.orders:
                rs.orders.pop(0)
            rs.orders.append(build_order(cfg, rs.runtime))
        else:
            rs.score -= cfg.get('wrongOrderPenalty', 5)
        player.currentItem = None
        _unregister_item_uuids(rs, item)
    return True


def try_stack_combination(rs: RoomState, room: str, player: Player, item: Item) -> bool:
    runtime = getattr(rs, 'runtime', {})
    stack_tolerance = PLAYER_RADIUS + 8
    with _room_lock(rs):
        for other in rs.items:
            if other is item:
                continue
            dx = other.x - item.x
            dy = other.y - item.y
            if abs(dx) > stack_tolerance or abs(dy) > stack_tolerance:
                continue
            recipe = find_combination_recipe_from_index(
                runtime.get('combination_index'),
                item.type,
                item.state,
                other.type,
                other.state,
            )
            if not recipe:
                recipe = find_combination_recipe(
                    rs.config.get('combinationRecipes'),
                    item.type,
                    item.state,
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
            release_cooking_task_for_item(rs, room, other)
            release_cooking_task_for_item(rs, room, item)
            combined_uuids = _normalize_uuid_list(
                list(getattr(other, 'uuids', []) or []) + list(getattr(item, 'uuids', []) or [])
            )
            _unregister_item_uuids(rs, item)
            other.uuids = combined_uuids
            _register_item_uuids(rs, other)
            other.type = result_type
            other.state = result_state
            other.display = format_item_display(result_type, result_state)
            player.currentItem = None
            return True
    return False


def drop_item_to_world(rs: RoomState, room: str, player: Player, item: Item, x: float, y: float):
    with _room_lock(rs):
        item.x = x
        item.y = y
        item.display = format_item_display(item.type, item.state)
        release_cooking_task_for_item(rs, room, item)
        for tr in rs.config.get('transferObjects', []):
            src = tr.get('sourceZone')
            dest = tr.get('destination')
            if not src or not dest:
                continue
            if in_zone(x, y, src):
                item.x = dest.get('x', item.x)
                item.y = dest.get('y', item.y)
                break
        placed = _register_world_item(rs, item, assign_new_id=True)
        if not placed:
            _register_item_uuids(rs, item)
            player.currentItem = item
            return
        player.currentItem = None


def reset_room(room: str) -> bool:
    """Reset the server-side state of *room* to its initial gameplay values."""
    if room not in rooms:
        return False
    rs = rooms[room]
    cfg = rs.config
    with _room_lock(rs):
        for zone in cfg.get('actionZones', []):
            if not clear_zone_cooking(rs, zone):
                zone['occupied'] = False
        registry = _ensure_cooking_registry(rs)
        registry.clear()
        rs.timer = cfg.get('gameTime', rs.timer)
        rs.score = 0
        rs.gameOver = False
        rs.orders = [build_order(cfg, rs.runtime) for _ in range(3)]
        rs.resetScheduled = False
    refresh_orders_metadata(rs)
    mark_dirty(room)
    return True


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
            uuids=[uuid.uuid4().hex],
        )
        _register_world_item(rs, itm, assign_new_id=True)

    rooms[room] = rs
    mark_dirty(room)

# ─────────────────────────────────────────

def run_cooking_task(room: str, zone: dict, task: dict):
    if room not in rooms or rooms[room].clientManaged:
        return

    sio = _require_socketio()
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

    raw_result = task.get('result_item_id')
    try:
        result_item_id = int(raw_result)
    except (TypeError, ValueError):
        result_item_id = None
    burned = bool(task.get('burned'))
    burn_display_at: Optional[float] = task.get('burnedAt') if burned else None

    settlement = task.get('settlement')
    if not isinstance(settlement, dict):
        settlement = {
            'id': uuid.uuid4().hex,
            'status': 'pending',
            'createdAt': start,
        }
        task['settlement'] = settlement

    while True:
        sio.sleep(0.1)
        if room not in rooms:
            return

        rs = rooms[room]
        dirty = False
        should_exit = False

        with _room_lock(rs):
            current = zone.get('cooking')
            if not current or current.get('id') != task['id']:
                settlement = task.get('settlement')
                if _settlement_is_open(settlement):
                    source_payload = task.get('source_item') or {}
                    restored = _item_from_snapshot(source_payload, rs.nextItemId)
                    if isinstance(zone, dict):
                        restored.x = zone.get('x', restored.x)
                        restored.y = zone.get('y', restored.y)
                    if not restored.display:
                        restored.display = format_item_display(restored.type, restored.state)
                    restored_item = _register_world_item(rs, restored, assign_new_id=False)
                    now = time.time()
                    if restored_item:
                        settlement['status'] = 'voided'
                        settlement['closedAt'] = now
                        settlement['voidReason'] = 'cancelled'
                        settlement.pop('lastError', None)
                        settlement.pop('lastFailure', None)
                        dirty = True
                    else:
                        settlement['lastError'] = 'uuid-conflict'
                        settlement['lastFailure'] = now
                        dirty = True
                if isinstance(zone, dict):
                    if zone.get('occupied'):
                        dirty = True
                    zone['occupied'] = False
                _untrack_cooking_task(rs, task.get('id'))
                should_exit = True
            else:
                now = time.time()
                elapsed = now - start
                progress = max(0.0, min(elapsed / duration, 1.0))

                settlement = current.get('settlement')
                if not isinstance(settlement, dict):
                    settlement = {
                        'id': uuid.uuid4().hex,
                        'status': 'pending',
                        'createdAt': start,
                    }
                    current['settlement'] = settlement

                if abs(current.get('progress', 0.0) - progress) > 1e-4:
                    current['progress'] = progress
                    dirty = True
                if abs(current.get('elapsed', 0.0) - elapsed) > 1e-4:
                    current['elapsed'] = elapsed
                    dirty = True

                if result_item_id is None:
                    raw_current_id = current.get('result_item_id')
                    try:
                        result_item_id = int(raw_current_id)
                    except (TypeError, ValueError):
                        result_item_id = None
                if result_item_id is None and isinstance(settlement.get('resultItemId'), (int, float, str)):
                    try:
                        result_item_id = int(settlement['resultItemId'])
                    except (TypeError, ValueError):
                        result_item_id = None

                remaining = 0.0 if result_item_id is not None else max(duration - elapsed, 0.0)
                if abs(current.get('remaining', 0.0) - remaining) > 1e-4:
                    current['remaining'] = remaining
                    dirty = True

                if result_item_id is None and progress >= 1.0 and settlement.get('status') != 'settled':
                    source_payload = task.get('source_item') or {}
                    cooked = _item_from_snapshot(source_payload, rs.nextItemId)
                    cooked.type = task['result_type']
                    cooked.state = task['result_state']
                    cooked.x = zone['x']
                    cooked.y = zone['y']
                    display = task.get('result_display') or format_item_display(
                        task['result_type'], task['result_state']
                    )
                    cooked.display = display
                    registered = _register_world_item(rs, cooked, assign_new_id=True)
                    if not registered:
                        settlement['status'] = 'pending'
                        settlement['lastError'] = 'uuid-conflict'
                        settlement['lastFailure'] = now
                        dirty = True
                    else:
                        cooked = registered
                        result_item_id = cooked.id
                        current['result_item_id'] = result_item_id
                        current['result_item_state'] = result_state
                        if result_type and result_state is not None:
                            current['texture'] = f"{result_type}:{result_state}"
                        current['finishedAt'] = now
                        current['displayText'] = display
                        settlement['status'] = 'settled'
                        settlement['resultItemId'] = result_item_id
                        settlement['settledAt'] = now
                        settlement.pop('lastError', None)
                        settlement.pop('lastFailure', None)
                        dirty = True

                if result_item_id is not None and not burned:
                    lookup = _ensure_item_lookup(rs)
                    if result_item_id not in lookup:
                        if settlement.get('status') != 'captured':
                            settlement['status'] = 'captured'
                            settlement['closedAt'] = now
                        if _clear_zone_cooking(rs, zone):
                            dirty = True
                        should_exit = True
                    elif burn_threshold and burn_threshold > 0.0 and elapsed >= burn_threshold:
                        removed = _remove_world_item(rs, result_item_id, room=room)
                        if removed:
                            _unregister_item_uuids(rs, removed)
                            current['displayText'] = '消し炭になってしまった！'
                            current['progress'] = 0.0
                            current['remaining'] = 0.0
                            current['burned'] = True
                            current['burnedAt'] = now
                            settlement['status'] = 'voided'
                            settlement['closedAt'] = now
                            burned = True
                            burn_display_at = now
                            dirty = True

                if burned and burn_display_at:
                    if (now - burn_display_at) >= 1.5:
                        if _clear_zone_cooking(rs, zone):
                            dirty = True
                        settlement.setdefault('closedAt', now)
                        should_exit = True

        if dirty:
            mark_dirty(room)
        if should_exit:
            return

