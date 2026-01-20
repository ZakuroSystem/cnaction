"""Persistence helpers for saved room configurations."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict


@dataclass(frozen=True, slots=True)
class RoomSnapshot:
    name: str
    config: dict


class RoomStore:
    """Persist room configuration snapshots on disk as JSON."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> Dict[str, RoomSnapshot]:
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as stream:
                data = json.load(stream)
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(data, dict):
            return {}
        rooms = data.get("rooms", {})
        if not isinstance(rooms, dict):
            return {}
        snapshots: Dict[str, RoomSnapshot] = {}
        for name, cfg in rooms.items():
            if not isinstance(name, str):
                continue
            if not isinstance(cfg, dict):
                continue
            snapshots[name] = RoomSnapshot(name=name, config=cfg)
        return snapshots

    def save(self, rooms: Dict[str, dict]) -> None:
        payload = {"rooms": rooms}
        with self.path.open("w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)


__all__ = ["RoomStore", "RoomSnapshot"]
