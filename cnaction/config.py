"""Configuration helpers for CNACTION."""
from __future__ import annotations

import random
import time
import uuid
from typing import Dict

from .constants import (
    DEFAULT_ACTION_ZONES,
    DEFAULT_BAKE_DURATION,
    DEFAULT_CUT_DURATION,
    DEFAULT_DELIVERY_ZONE,
    DEFAULT_GENERATOR,
)
from .values import coerce_float
from utils import (
    default_cooking_recipes,
    default_combination_recipes,
    default_item_state,
    dish_types,
    format_item_display,
    get_dish_name,
    ingredient_types,
)


def clone_default_action_zones() -> list:
    """Return a deep-ish copy of the default action zone configuration."""
    zones = []
    for zone in DEFAULT_ACTION_ZONES:
        cloned = dict(zone)
        cloned['occupied'] = False
        cloned.pop('cooking', None)
        zones.append(cloned)
    return zones


def sanitize_config(cfg: dict) -> dict:
    """Normalize the in-memory configuration coming from the client/editor."""
    cfg = dict(cfg or {})

    ingredient_list = ingredient_types()
    dish_list = dish_types()
    default_mapping = {t: get_dish_name(t) or t for t in dish_list}

    sanitized_mapping: Dict[str, str] = {}
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
        cloned['display'] = zone.get('display') or (
            '切っている…' if action == 'cut' else '焼いている…'
        )
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

            settlement_payload = cooking_payload.get('settlement')
            normalized_settlement = {}
            if isinstance(settlement_payload, dict):
                settlement_id = settlement_payload.get('id') or settlement_payload.get('settlementId')
                if not settlement_id:
                    settlement_id = uuid.uuid4().hex
                normalized_settlement['id'] = str(settlement_id)
                status = settlement_payload.get('status') or 'pending'
                normalized_settlement['status'] = status
                try:
                    normalized_settlement['createdAt'] = float(settlement_payload.get('createdAt'))
                except (TypeError, ValueError):
                    normalized_settlement['createdAt'] = time.time()
                if settlement_payload.get('sourceItemId') is not None:
                    normalized_settlement['sourceItemId'] = settlement_payload.get('sourceItemId')
                if settlement_payload.get('resultItemId') is not None:
                    normalized_settlement['resultItemId'] = settlement_payload.get('resultItemId')
                try:
                    settled_at = float(settlement_payload.get('settledAt'))
                except (TypeError, ValueError):
                    settled_at = None
                if settled_at is not None:
                    normalized_settlement['settledAt'] = settled_at
                try:
                    closed_at = float(settlement_payload.get('closedAt'))
                except (TypeError, ValueError):
                    closed_at = None
                if closed_at is not None:
                    normalized_settlement['closedAt'] = closed_at
            else:
                normalized_settlement = {
                    'id': uuid.uuid4().hex,
                    'status': 'pending',
                    'createdAt': time.time(),
                }

            sanitized_task = {
                'id': str(cooking_payload.get('id') or uuid.uuid4().hex),
                'progress': progress_val,
                'duration': duration_val,
                'texture': cooking_payload.get('texture'),
                'itemType': cooking_payload.get('itemType'),
                'displayText': cooking_payload.get('displayText')
                or cloned['display']
                or ('切っている…' if action == 'cut' else '焼いている…'),
                'result_type': result_type,
                'result_state': result_state,
                'result_display': cooking_payload.get('result_display')
                or (
                    format_item_display(result_type, result_state) if result_type else None
                ),
                'startedAt': started_at,
                'settlement': normalized_settlement,
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
        sanitized_zones = clone_default_action_zones()

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
        base['x'] = coerce_float(base.get('x'), 0.0)
        base['y'] = coerce_float(base.get('y'), 0.0)
        width = coerce_float(base.get('width'), 96.0)
        height = coerce_float(base.get('height'), 96.0)
        base['width'] = max(16.0, width if width else 96.0)
        base['height'] = max(16.0, height if height else 96.0)
        return base

    def _sanitize_obstacle_list(values):
        sanitized = []
        for entry in values or []:
            if isinstance(entry, dict):
                sanitized.append(_sanitize_obstacle(entry))
        return sanitized

    static_obstacles = _sanitize_obstacle_list(cfg.get('staticObstacles'))
    moving_obstacles = _sanitize_obstacle_list(cfg.get('movingObstacles'))
    cfg['staticObstacles'] = static_obstacles + moving_obstacles
    cfg['movingObstacles'] = []
    cfg.setdefault('transferObjects', [])

    return cfg
