"""Persistence helpers for stage editor configurations."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List
import copy


@dataclass(slots=True)
class StageSummary:
    key: str
    name: str
    updated: int
    locked: bool


class StageStore:
    """Persist stage configurations on disk as JSON."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def list(self) -> List[StageSummary]:
        summaries: List[StageSummary] = []
        for path in self.directory.glob("*.json"):
            if not path.is_file():
                continue
            key = path.stem
            try:
                with path.open("r", encoding="utf-8") as stream:
                    data = json.load(stream)
            except (OSError, json.JSONDecodeError):
                continue
            meta = data.get("meta", {}) if isinstance(data, dict) else {}
            name = str(meta.get("name") or key)
            updated = int(meta.get("updated") or path.stat().st_mtime)
            locked = bool(meta.get("locked"))
            summaries.append(StageSummary(key=key, name=name, updated=updated, locked=locked))
        summaries.sort(key=lambda item: item.updated, reverse=True)
        return summaries

    def save(self, key: str, name: str, config: dict, *, password: str, locked: bool = False) -> None:
        if not isinstance(config, dict):
            raise ValueError("Stage config must be a mapping")
        if not isinstance(password, str):
            password = ""
        password = password.strip()
        if locked and not password:
            raise ValueError("Stage password is required when locked")

        normalized_name = str(name or key).strip()
        for path in self.directory.glob("*.json"):
            if path.stem == key:
                continue
            try:
                with path.open("r", encoding="utf-8") as stream:
                    existing = json.load(stream)
            except (OSError, json.JSONDecodeError):
                continue
            meta = existing.get("meta", {}) if isinstance(existing, dict) else {}
            existing_name = str(meta.get("name") or path.stem).strip()
            if existing_name == normalized_name and bool(meta.get("locked")):
                raise ValueError("そのルーム名は既に使われています")

        payload = {
            "meta": {
                "name": normalized_name,
                "updated": int(time.time()),
                "locked": bool(locked),
                "password": password,
            },
            "config": config,
        }
        path = self.directory / f"{key}.json"
        with path.open("w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)


    def can_edit(self, key: str, password: str | None) -> bool:
        data = self.load(key)
        if data is None:
            return False
        meta = data.get("meta", {}) if isinstance(data, dict) else {}
        if not bool(meta.get("locked")):
            return True
        expected = str(meta.get("password") or "")
        return bool(password) and str(password) == expected

    def copy_as_new(self, source_key: str, new_key: str) -> dict:
        source = self.load(source_key)
        if source is None:
            raise ValueError("source stage not found")
        meta = source.get("meta", {}) if isinstance(source, dict) else {}
        name = str(meta.get("name") or source_key)
        copied_name = f"{name} (copy)"
        config = copy.deepcopy(source.get("config") or {})
        self.save(new_key, copied_name, config, password="copy", locked=False)
        return {"key": new_key, "name": copied_name}

    def load(self, key: str) -> dict | None:
        path = self.directory / f"{key}.json"
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)


__all__ = ["StageStore", "StageSummary"]
