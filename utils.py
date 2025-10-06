import os
import random
import json
import datetime
import shutil
import time
from io import BytesIO
from typing import Optional, Dict, List

from flask import send_file


STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')


INGREDIENT_DEFS = {
    'ingredient_tomato': {
        'name': 'トマト',
        'dish': 'トマト(切って焼いたもの)',
    },
    'ingredient_lettuce': {
        'name': 'レタス',
        'dish': 'レタス(切って焼いたもの)',
    },
    'ingredient_bread': {
        'name': 'バンズ',
        'dish': 'バンズ(切って焼いたもの)',
    },
}

STATE_LABELS = {
    'raw': '生',
    'chopped': 'カット済み',
    'cooked': '焼き上がり',
}


def _normalize_static_url(path: str) -> Optional[str]:
    if not path:
        return None
    if path.startswith('http://') or path.startswith('https://'):
        return path
    if path.startswith('/static/'):
        return path
    if path.startswith('/'):
        return '/static' + path
    return f'/static/{path}'


def _static_url_if_exists(rel_path: str) -> Optional[str]:
    rel_path = rel_path.lstrip('/').replace('\\', '/')
    full_path = os.path.join(STATIC_DIR, rel_path)
    if os.path.exists(full_path):
        return f'/static/{rel_path}'
    return None


def resolve_order_item_type(cfg: dict, dish: str) -> Optional[str]:
    for item_type, mapped_dish in (cfg.get('orderMapping') or {}).items():
        if mapped_dish == dish:
            return item_type
    return None


def ingredient_types() -> List[str]:
    return list(INGREDIENT_DEFS.keys())


def get_dish_name(item_type: str) -> Optional[str]:
    return INGREDIENT_DEFS.get(item_type, {}).get('dish')


def format_item_display(item_type: str, state: str) -> str:
    base = INGREDIENT_DEFS.get(item_type, {}).get('name', item_type)
    label = STATE_LABELS.get(state, state)
    return f'{base} ({label})'


def resolve_item_image(cfg: dict, item_type: Optional[str]) -> Optional[str]:
    if not item_type:
        return None

    for item in cfg.get('customItems') or []:
        if item.get('type') == item_type and item.get('image'):
            return _normalize_static_url(item['image'])

    name_candidates = {item_type}
    if item_type.startswith('ingredient_'):
        name_candidates.add(item_type[len('ingredient_'):])

    exts = ['.png', '.jpg', '.jpeg', '.gif']
    subdirs = ['assets/dish', 'assets/ingredient', 'assets']

    for name in name_candidates:
        for ext in exts:
            for subdir in subdirs:
                rel = f'{subdir}/{name}{ext}' if subdir else f'{name}{ext}'
                url = _static_url_if_exists(rel)
                if url:
                    return url

    return None


def build_order(cfg: dict) -> dict:
    dishes = cfg.get('dishList') or []
    dish = random.choice(dishes) if dishes else ''
    limit = cfg.get('orderTimeLimit', 30)
    item_type = resolve_order_item_type(cfg, dish)
    image = resolve_item_image(cfg, item_type)

    order = {
        'dish': dish,
        'remaining': limit,
    }

    if item_type:
        order['itemType'] = item_type
    if image:
        order['image'] = image

    return order

# Configuration helpers

def get_default_config() -> dict:
    ingredient_list = ingredient_types()
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
            'nextFood': random.choice(ingredient_list)
        }],
        'transferObjects': [],
        'dishList': [INGREDIENT_DEFS[t]['dish'] for t in ingredient_list],
        'orderMapping': {t: INGREDIENT_DEFS[t]['dish'] for t in ingredient_list},
        'cutDuration': 2.0,
        'bakeDuration': 3.0,
    }

# Utility functions

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
        except Exception:
            pass
    return objs

def update_orders(room: str, rooms: Dict[str, 'RoomState']):
    rs = rooms[room]
    cfg = rs.config
    new_orders = []
    for o in rs.orders:
        o['remaining'] = max(0, o.get('remaining', 0) - 1)
        if o['remaining'] <= 0:
            rs.score -= cfg.get('wrongOrderPenalty', 5)
            new_orders.append(build_order(cfg))
        else:
            if 'itemType' not in o:
                item_type = resolve_order_item_type(cfg, o.get('dish', ''))
                if item_type:
                    o['itemType'] = item_type
            if 'image' not in o:
                image = resolve_item_image(cfg, o.get('itemType'))
                if image:
                    o['image'] = image
            new_orders.append(o)
    rs.orders = new_orders

def export_config_response(room: str, rooms: Dict[str, 'RoomState']):
    cfg = rooms.get(room).config if room in rooms else get_default_config()
    js = json.dumps(cfg, ensure_ascii=False, indent=2)
    return send_file(BytesIO(js.encode('utf-8')),
                     mimetype='application/json',
                     as_attachment=True,
                     download_name=f'{room or "default"}_config.json')


def save_uploaded_file(file, dest: str, backup_folder: str, item_name: str):
    if os.path.exists(dest):
        ts = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
        shutil.move(dest, os.path.join(backup_folder, f"{item_name}_{ts}{os.path.splitext(dest)[1]}"))
    file.save(dest)


def delayed_task(delay: float, fn, *args, **kwargs):
    time.sleep(delay)
    fn(*args, **kwargs)
