from dataclasses import dataclass, field
from threading import RLock
from typing import Dict, List, Optional

from utils import get_default_config

@dataclass
class Item:
    id: int
    type: str
    x: float
    y: float
    state: str = 'raw'
    display: Optional[str] = None
    uuids: List[str] = field(default_factory=list)

@dataclass
class Player:
    x: float = 100
    y: float = 100
    currentItem: Optional['Item'] = None
    cooking: bool = False
    currentZone: Optional[dict] = None
    base_image: str = ''
    image: str = ''
    lastMoveSeq: int = 0

@dataclass
class RoomState:
    players: Dict[str, Player] = field(default_factory=dict)
    items: List[Item] = field(default_factory=list)
    item_lookup: Dict[int, Item] = field(default_factory=dict, repr=False, compare=False)
    uuid_lookup: Dict[str, Item] = field(default_factory=dict, repr=False, compare=False)
    cooking_tasks: Dict[str, dict] = field(default_factory=dict, repr=False, compare=False)
    orders: List[dict] = field(default_factory=list)
    score: int = 0
    timer: int = 60
    gameOver: bool = False
    config: dict = field(default_factory=get_default_config)
    nextItemId: int = 1
    resetScheduled: bool = False
    hostId: str = ''
    clientManaged: bool = False
    runtime: dict = field(default_factory=dict, repr=False, compare=False)
    configRevision: int = 0
    lock: RLock = field(default_factory=RLock, repr=False, compare=False)
