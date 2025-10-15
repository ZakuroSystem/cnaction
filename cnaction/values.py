"""Utility helpers shared across modules."""
from __future__ import annotations

from typing import Iterable, List, Optional


def coerce_float(value, default: float = 0.0) -> float:
    """Best-effort conversion of *value* to float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_int(value, default: int = 0) -> int:
    """Best-effort conversion of *value* to int."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_uuid_list(raw: Optional[Iterable[str]]) -> List[str]:
    """Normalize a list-like payload of UUID strings."""
    if isinstance(raw, str):
        raw = [raw]

    uuids: List[str] = []
    if isinstance(raw, (list, tuple, set)):
        for value in raw:
            if isinstance(value, str):
                value = value.strip()
            if not value or not isinstance(value, str):
                continue
            if value in uuids:
                continue
            uuids.append(value)
    return uuids
