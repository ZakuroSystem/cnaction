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


STATE_LABELS = {
    'raw': '生',
    'chopped': 'カット済み',
    'cooked': '焼き上がり',
    'toasted': 'トースト済み',
    'assembled': '完成',
}


ITEM_LIBRARY = {
    'ingredient_burger_buns': {
        'name': 'バンズ',
        'default_state': 'raw',
        'states': {
            'raw': {
                'label': 'そのまま',
                'image': '/static/new_items/burger_buns.png',
            },
            'toasted': {
                'label': 'トースト',
                'image': '/static/new_items/burger_buns.png',
            },
        },
    },
    'ingredient_beef_patty': {
        'name': 'ビーフパティ',
        'default_state': 'raw',
        'states': {
            'raw': {
                'label': '生',
                'image': '/static/new_items/beef_patty.png',
            },
            'cooked': {
                'label': 'グリル済み',
                'image': '/static/new_items/grilled_beef_patty.png',
            },
        },
    },
    'ingredient_lettuce': {
        'name': 'レタス',
        'default_state': 'raw',
        'states': {
            'raw': {
                'label': 'そのまま',
                'image': '/static/new_items/lettuce.png',
            },
            'chopped': {
                'label': '刻み',
                'image': '/static/new_items/lettuce_cut.png',
            },
        },
    },
    'ingredient_tomato': {
        'name': 'トマト',
        'default_state': 'raw',
        'states': {
            'raw': {
                'label': 'そのまま',
                'image': '/static/new_items/TMT.png',
            },
            'chopped': {
                'label': 'スライス',
                'image': '/static/new_items/TMT_slice.png',
            },
        },
    },
    'dish_plain_burger': {
        'name': 'プレーンバーガー',
        'dish': 'プレーンバーガー',
        'default_state': 'assembled',
        'states': {
            'assembled': {
                'label': '完成',
                'image': '/static/new_items/hamburger.png',
            },
        },
        'components': [
            {'type': 'ingredient_burger_buns', 'state': 'toasted'},
            {'type': 'ingredient_beef_patty', 'state': 'cooked'},
        ],
    },
    'dish_lettuce_burger': {
        'name': 'レタスバーガー',
        'dish': 'レタスバーガー',
        'default_state': 'assembled',
        'states': {
            'assembled': {
                'label': '完成',
                'image': '/static/new_items/hamburger.png',
            },
        },
        'components': [
            {'type': 'ingredient_burger_buns', 'state': 'toasted'},
            {'type': 'ingredient_beef_patty', 'state': 'cooked'},
            {'type': 'ingredient_lettuce', 'state': 'chopped'},
        ],
    },
    'dish_tomato_burger': {
        'name': 'トマトバーガー',
        'dish': 'トマトバーガー',
        'default_state': 'assembled',
        'states': {
            'assembled': {
                'label': '完成',
                'image': '/static/new_items/hamburger.png',
            },
        },
        'components': [
            {'type': 'ingredient_burger_buns', 'state': 'toasted'},
            {'type': 'ingredient_beef_patty', 'state': 'cooked'},
            {'type': 'ingredient_tomato', 'state': 'chopped'},
        ],
    },
    'dish_deluxe_burger': {
        'name': 'デラックスバーガー',
        'dish': 'デラックスバーガー',
        'default_state': 'assembled',
        'states': {
            'assembled': {
                'label': '完成',
                'image': '/static/new_items/hamburger.png',
            },
        },
        'components': [
            {'type': 'ingredient_burger_buns', 'state': 'toasted'},
            {'type': 'ingredient_beef_patty', 'state': 'cooked'},
            {'type': 'ingredient_lettuce', 'state': 'chopped'},
            {'type': 'ingredient_tomato', 'state': 'chopped'},
        ],
    },
}


_INGREDIENT_TYPES = tuple(
    key for key in ITEM_LIBRARY if key.startswith('ingredient_')
)
_DISH_TYPES = tuple(
    key for key, value in ITEM_LIBRARY.items() if value.get('dish')
)


COOKING_RECIPES = [
    {
        'type': 'ingredient_burger_buns',
        'from': 'raw',
        'to': 'toasted',
        'action': 'bake',
        'duration': 2.5,
        'display': 'バンズをトーストしている…',
    },
    {
        'type': 'ingredient_beef_patty',
        'from': 'raw',
        'to': 'cooked',
        'action': 'bake',
        'duration': 3.5,
        'display': 'パティを焼いている…',
    },
    {
        'type': 'ingredient_lettuce',
        'from': 'raw',
        'to': 'chopped',
        'action': 'cut',
        'duration': 2.0,
        'display': 'レタスを刻んでいる…',
    },
    {
        'type': 'ingredient_tomato',
        'from': 'raw',
        'to': 'chopped',
        'action': 'cut',
        'duration': 2.5,
        'display': 'トマトをスライスしている…',
    },
]


COMBINATION_RECIPES = [
    {
        'inputs': [
            {'type': 'ingredient_burger_buns', 'state': 'toasted'},
            {'type': 'ingredient_beef_patty', 'state': 'cooked'},
        ],
        'result': {'type': 'dish_plain_burger', 'state': 'assembled'},
        'name': 'プレーンバーガー',
    },
    {
        'inputs': [
            {'type': 'dish_plain_burger', 'state': 'assembled'},
            {'type': 'ingredient_lettuce', 'state': 'chopped'},
        ],
        'result': {'type': 'dish_lettuce_burger', 'state': 'assembled'},
        'name': 'レタスバーガー',
    },
    {
        'inputs': [
            {'type': 'dish_plain_burger', 'state': 'assembled'},
            {'type': 'ingredient_tomato', 'state': 'chopped'},
        ],
        'result': {'type': 'dish_tomato_burger', 'state': 'assembled'},
        'name': 'トマトバーガー',
    },
    {
        'inputs': [
            {'type': 'dish_lettuce_burger', 'state': 'assembled'},
            {'type': 'ingredient_tomato', 'state': 'chopped'},
        ],
        'result': {'type': 'dish_deluxe_burger', 'state': 'assembled'},
        'name': 'デラックスバーガー',
    },
    {
        'inputs': [
            {'type': 'dish_tomato_burger', 'state': 'assembled'},
            {'type': 'ingredient_lettuce', 'state': 'chopped'},
        ],
        'result': {'type': 'dish_deluxe_burger', 'state': 'assembled'},
        'name': 'デラックスバーガー',
    },
]


def default_cooking_recipes() -> List[dict]:
    return [dict(recipe) for recipe in COOKING_RECIPES]


def default_combination_recipes() -> List[dict]:
    return [
        {
            'inputs': [dict(component) for component in recipe.get('inputs', [])],
            'result': dict(recipe.get('result', {})),
            'name': recipe.get('name'),
        }
        for recipe in COMBINATION_RECIPES
    ]


def match_requirement(item_type: Optional[str], item_state: Optional[str], requirement: dict) -> bool:
    if not requirement:
        return False
    req_type = requirement.get('type')
    if req_type and req_type != item_type:
        return False
    req_state = requirement.get('state')
    if req_state and req_state != item_state:
        return False
    return True


def find_combination_recipe(recipes: List[dict], type_a: str, state_a: str, type_b: str, state_b: str) -> Optional[dict]:
    for recipe in recipes or []:
        inputs = recipe.get('inputs') or []
        if len(inputs) != 2:
            continue
        left, right = inputs
        if match_requirement(type_a, state_a, left) and match_requirement(type_b, state_b, right):
            return recipe
        if match_requirement(type_a, state_a, right) and match_requirement(type_b, state_b, left):
            return recipe
    return None


def find_combination_recipe_by_type(recipes: List[dict], type_a: str, type_b: str) -> Optional[dict]:
    for recipe in recipes or []:
        inputs = recipe.get('inputs') or []
        if len(inputs) != 2:
            continue
        left, right = inputs
        if match_requirement(type_a, None, left) and match_requirement(type_b, None, right):
            return recipe
        if match_requirement(type_a, None, right) and match_requirement(type_b, None, left):
            return recipe
    return None


def _normalize_state_key(value: Optional[str]) -> Optional[str]:
    return value or None


def build_cooking_lookup(recipes: List[dict]) -> Dict[str, List[dict]]:
    lookup: Dict[str, List[dict]] = {}
    for recipe in recipes or []:
        if not isinstance(recipe, dict):
            continue
        item_type = recipe.get('type')
        if not item_type:
            continue
        lookup.setdefault(item_type, []).append(recipe)
    return lookup


def find_cooking_recipe(lookup: Dict[str, List[dict]], item_type: Optional[str], item_state: Optional[str]) -> Optional[dict]:
    if not lookup or not item_type:
        return None
    for recipe in lookup.get(item_type, []):
        if not isinstance(recipe, dict):
            continue
        required_state = recipe.get('from')
        if required_state and required_state != item_state:
            continue
        action = recipe.get('action')
        result_state = recipe.get('to')
        if not action or result_state is None:
            continue
        return recipe
    return None


def _combination_key(item_type: Optional[str], item_state: Optional[str]) -> Optional[tuple]:
    if not item_type:
        return None
    return item_type, _normalize_state_key(item_state)


def build_combination_index(recipes: List[dict]) -> Dict[tuple, List[tuple]]:
    index: Dict[tuple, List[tuple]] = {}
    for recipe in recipes or []:
        if not isinstance(recipe, dict):
            continue
        inputs = recipe.get('inputs') or []
        if len(inputs) != 2:
            continue
        normalized = []
        for component in inputs:
            if not isinstance(component, dict):
                normalized = []
                break
            key = _combination_key(component.get('type'), component.get('state'))
            if not key:
                normalized = []
                break
            normalized.append({'type': key[0], 'state': key[1]})
        if len(normalized) != 2:
            continue
        for first_idx in (0, 1):
            primary = normalized[first_idx]
            secondary = normalized[1 - first_idx]
            bucket = index.setdefault((primary['type'], primary['state']), [])
            bucket.append((secondary, recipe))
    return index


def find_combination_recipe_from_index(index: Dict[tuple, List[tuple]], type_a: Optional[str], state_a: Optional[str],
                                       type_b: Optional[str], state_b: Optional[str]) -> Optional[dict]:
    if not index or not type_a or not type_b:
        return None
    keys = []
    normalized_state = _normalize_state_key(state_a)
    keys.append((type_a, normalized_state))
    keys.append((type_a, None))
    seen = set()
    for key in keys:
        if key in seen:
            continue
        seen.add(key)
        bucket = index.get(key)
        if not bucket:
            continue
        for requirement, recipe in bucket:
            if match_requirement(type_b, state_b, requirement):
                return recipe
    return None


def build_runtime_metadata(cfg: dict) -> dict:
    cfg = cfg or {}
    runtime: dict = {}

    cooking_recipes = cfg.get('cookingRecipes') or []
    combination_recipes = cfg.get('combinationRecipes') or []
    runtime['cooking_lookup'] = build_cooking_lookup(cooking_recipes)
    runtime['combination_index'] = build_combination_index(combination_recipes)

    mapping = cfg.get('orderMapping') or {}
    runtime['order_lookup'] = {
        dish: item_type
        for item_type, dish in mapping.items()
        if isinstance(dish, str) and dish
    }

    custom_items = {}
    for item in cfg.get('customItems') or []:
        if not isinstance(item, dict):
            continue
        item_type = item.get('type')
        image = item.get('image')
        if not item_type or not image:
            continue
        normalized = _normalize_static_url(image)
        custom_items[item_type] = normalized or image
    runtime['custom_items'] = custom_items

    order_images = {}
    component_cache = {}
    for item_type in ITEM_LIBRARY.keys():
        default_state = default_item_state(item_type)
        image = custom_items.get(item_type) or resolve_item_image(cfg, item_type, default_state)
        if image:
            order_images[item_type] = image

        info = item_definition(item_type)
        components_meta = []
        for component in info.get('components', []) or []:
            comp_type = component.get('type')
            if not comp_type:
                continue
            comp_state = component.get('state')
            label = format_item_display(comp_type, comp_state)
            comp_image = custom_items.get(comp_type) or resolve_item_image(cfg, comp_type, comp_state)
            components_meta.append({
                'type': comp_type,
                'state': comp_state,
                'label': label,
                'image': comp_image,
            })
        if components_meta:
            component_cache[item_type] = {
                'labels': tuple(component['label'] for component in components_meta),
                'items': tuple(components_meta),
            }

    runtime['order_images'] = order_images
    runtime['component_cache'] = component_cache
    return runtime


def hydrate_order(cfg: dict, runtime: Optional[dict], order: dict) -> dict:
    if not isinstance(order, dict):
        return order

    runtime = runtime or {}

    if not order.get('itemType'):
        dish = order.get('dish', '')
        if dish:
            lookup = runtime.get('order_lookup') or {}
            item_type = lookup.get(dish)
            if not item_type:
                item_type = resolve_order_item_type(cfg, dish)
            if item_type:
                order['itemType'] = item_type

    item_type = order.get('itemType')
    if not item_type:
        return order

    if not order.get('image'):
        image = (runtime.get('order_images') or {}).get(item_type)
        if not image:
            image = resolve_item_image(cfg, item_type, default_item_state(item_type))
        if image:
            order['image'] = image

    components_missing = not order.get('components') or not order.get('componentItems')
    if components_missing:
        cached = (runtime.get('component_cache') or {}).get(item_type)
        if cached:
            order['components'] = list(cached['labels'])
            order['componentItems'] = [dict(component) for component in cached['items']]
        else:
            info = item_definition(item_type)
            components_meta = []
            for component in info.get('components', []) or []:
                comp_type = component.get('type')
                if not comp_type:
                    continue
                comp_state = component.get('state')
                label = format_item_display(comp_type, comp_state)
                comp_image = resolve_item_image(cfg, comp_type, comp_state)
                components_meta.append({
                    'type': comp_type,
                    'state': comp_state,
                    'label': label,
                    'image': comp_image,
                })
            if components_meta:
                order['components'] = [c['label'] for c in components_meta]
                order['componentItems'] = components_meta

    return order


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


def item_definition(item_type: Optional[str]) -> dict:
    if not item_type:
        return {}
    return ITEM_LIBRARY.get(item_type, {})


def resolve_order_item_type(cfg: dict, dish: str) -> Optional[str]:
    for item_type, mapped_dish in (cfg.get('orderMapping') or {}).items():
        if mapped_dish == dish:
            return item_type
    return None


def ingredient_types() -> List[str]:
    return list(_INGREDIENT_TYPES)


def dish_types() -> List[str]:
    return list(_DISH_TYPES)


def get_dish_name(item_type: str) -> Optional[str]:
    info = item_definition(item_type)
    if not info:
        return None
    return info.get('dish') or info.get('name')


def default_item_state(item_type: str) -> str:
    info = item_definition(item_type)
    return info.get('default_state', 'raw')


def format_item_display(item_type: str, state: Optional[str]) -> str:
    info = item_definition(item_type)
    base = info.get('name', item_type)
    state_info = info.get('states', {}).get(state or '', {})
    label = state_info.get('label') or STATE_LABELS.get(state or '', state or '')
    if label:
        return f'{base} ({label})'
    return base


def resolve_item_image(cfg: dict, item_type: Optional[str], state: Optional[str] = None) -> Optional[str]:
    if not item_type:
        return None

    for item in cfg.get('customItems') or []:
        if item.get('type') == item_type and item.get('image'):
            return _normalize_static_url(item['image'])

    info = item_definition(item_type)
    state_key = state or info.get('default_state')
    if state_key:
        state_info = info.get('states', {}).get(state_key, {})
        if state_info.get('image'):
            return state_info['image']

    if info.get('states'):
        for state_info in info['states'].values():
            if state_info.get('image'):
                return state_info['image']

    name_candidates = {item_type}
    if item_type.startswith('ingredient_'):
        name_candidates.add(item_type[len('ingredient_'):])

    exts = ['.png', '.jpg', '.jpeg', '.gif']
    subdirs = ['assets/dish', 'assets/ingredient', 'assets', 'new_items']

    for name in name_candidates:
        for ext in exts:
            for subdir in subdirs:
                rel = f'{subdir}/{name}{ext}' if subdir else f'{name}{ext}'
                url = _static_url_if_exists(rel)
                if url:
                    return url

    return None


def build_order(cfg: dict, runtime: Optional[dict] = None) -> dict:
    mapping = cfg.get('orderMapping') or {}
    available_types = list(mapping.keys())
    if not available_types:
        available_types = dish_types()

    item_type = random.choice(available_types) if available_types else None
    dish_name = mapping.get(item_type) if item_type else None
    if not dish_name and item_type:
        dish_name = get_dish_name(item_type)

    try:
        limit = int(cfg.get('orderTimeLimit', 30))
    except (TypeError, ValueError):
        limit = 30

    order = {
        'dish': dish_name or '',
        'remaining': limit,
    }

    if item_type:
        order['itemType'] = item_type

    return hydrate_order(cfg, runtime, order)

# Configuration helpers

def get_default_config() -> dict:
    ingredient_list = ingredient_types()
    dish_list = dish_types()
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
        'staticObstacles': [
            {'x': 400, 'y': 300, 'width': 96, 'height': 96},
            {'x': 600, 'y': 300, 'width': 96, 'height': 96},
        ],
        'movingObstacles': [],
        'foodGenerators': [{
            'x': 750, 'y': 50, 'width': 96, 'height': 96,
            'nextFood': random.choice(ingredient_list)
        }],
        'transferObjects': [],
        'dishList': [get_dish_name(t) for t in dish_list],
        'orderMapping': {t: get_dish_name(t) for t in dish_list},
        'cutDuration': 2.0,
        'bakeDuration': 3.0,
        'cookingRecipes': default_cooking_recipes(),
        'combinationRecipes': default_combination_recipes(),
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
    runtime = getattr(rs, 'runtime', {})
    penalty = cfg.get('wrongOrderPenalty', 5)
    try:
        penalty = int(penalty)
    except (TypeError, ValueError):
        penalty = 5

    updated_orders = []
    for order in rs.orders:
        if not isinstance(order, dict):
            continue
        remaining = max(0, order.get('remaining', 0) - 1)
        if remaining <= 0:
            rs.score -= penalty
            updated_orders.append(build_order(cfg, runtime))
            continue

        order['remaining'] = remaining
        hydrate_order(cfg, runtime, order)
        updated_orders.append(order)

    rs.orders = updated_orders

def export_config_response(room: str, rooms: Dict[str, 'RoomState'], default_config: Optional[dict] = None):
    if room in rooms:
        cfg = rooms.get(room).config
    else:
        cfg = default_config if isinstance(default_config, dict) else get_default_config()
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
