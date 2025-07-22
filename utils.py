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
