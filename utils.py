import os
import random
import json
import itertools
import datetime
import shutil
import time
from io import BytesIO
from typing import Optional, Dict, List

from flask import send_file


STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')


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

def find_next_step(cfg: dict, item_type: str) -> Optional[dict]:
    """Return the next cooking step for the given item type.

    The previous implementation attempted to concatenate a ``zip`` object with a
    list, which raised ``TypeError`` and prevented any cooking action from being
    triggered.  This rewritten version iterates over each recipe and checks the
    base item and all subsequent steps sequentially.
    """

    recipes = cfg.get('cookingRecipes') or []
    if not isinstance(recipes, list):
        return None

    for recipe in recipes:
        prev_result = recipe.get('base')
        steps = recipe.get('steps') or []
        if not isinstance(steps, list):
            continue
        for step in steps:
            if prev_result == item_type:
                return {
                    'action': step.get('action'),
                    'result': step.get('result'),
                    'time': step.get('time'),
                }
            prev_result = step.get('result')
    return None

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

def process_combinations(room: str, rooms: Dict[str, 'RoomState'], Item):
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
                    for (x1,y1),(x2,y2) in itertools.combinations(coords,2)
                ):
                    for i in combo:
                        to_remove.add(i)
                    avgx = sum(x for x,_ in coords)/len(coords)
                    avgy = sum(y for _,y in coords)/len(coords)
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
