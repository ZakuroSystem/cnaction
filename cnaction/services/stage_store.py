"""Persistence helpers for stage editor configurations."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass(slots=True)
class StageSummary:
    key: str
    name: str
    updated: int


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
            summaries.append(StageSummary(key=key, name=name, updated=updated))
        summaries.sort(key=lambda item: item.updated, reverse=True)
        return summaries

    def save(self, key: str, name: str, config: dict) -> None:
        if not isinstance(config, dict):
            raise ValueError("Stage config must be a mapping")
        payload = {
            "meta": {"name": name, "updated": int(time.time())},
            "config": config,
        }
        path = self.directory / f"{key}.json"
        with path.open("w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)

    def load(self, key: str) -> dict | None:
        path = self.directory / f"{key}.json"
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)


__all__ = ["StageStore", "StageSummary"]
