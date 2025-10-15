"""Shared constants for the CNACTION server."""

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
COLLISION_EPSILON = 1e-6
