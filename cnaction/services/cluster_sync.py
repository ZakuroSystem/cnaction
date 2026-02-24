"""Cross-server state sync helpers."""
from __future__ import annotations

import copy
import json
import time
import urllib.parse
import urllib.request
from typing import Any

from cnaction import game
from cnaction.settings import AppSettings
from .stage_store import StageStore


def build_cluster_state(stage_store: StageStore) -> dict[str, Any]:
    rooms: dict[str, dict] = {}
    for room, rs in game.rooms.items():
        cfg = rs.config if isinstance(rs.config, dict) else None
        if isinstance(cfg, dict):
            rooms[room] = copy.deepcopy(cfg)

    stages: dict[str, dict] = {}
    for summary in stage_store.list():
        loaded = stage_store.load(summary.key)
        if isinstance(loaded, dict):
            stages[summary.key] = loaded

    return {
        "generatedAt": time.time(),
        "rooms": rooms,
        "persistentRooms": sorted(game.persistent_rooms),
        "roomRecords": copy.deepcopy(game.room_records),
        "stages": stages,
    }


def merge_cluster_state(payload: dict[str, Any], stage_store: StageStore, settings: AppSettings) -> dict[str, int]:
    merged = {"rooms": 0, "records": 0, "stages": 0}
    if not isinstance(payload, dict):
        return merged

    rooms = payload.get("rooms")
    if isinstance(rooms, dict):
        for room, cfg in rooms.items():
            if not isinstance(room, str) or not isinstance(cfg, dict):
                continue
            if room in game.rooms:
                game.assign_room_config(game.rooms[room], copy.deepcopy(cfg))
            else:
                game.initialize_room(room, copy.deepcopy(cfg))
            merged["rooms"] += 1

    persistent_rooms = payload.get("persistentRooms")
    if isinstance(persistent_rooms, list):
        for room in persistent_rooms:
            if isinstance(room, str):
                game.set_room_persistent(room, True)

    records = payload.get("roomRecords")
    if isinstance(records, dict):
        for room, rows in records.items():
            if not isinstance(room, str) or not isinstance(rows, list):
                continue
            local = game.room_records.setdefault(room, [])
            seen = {(int(r.get("score", 0)), float(r.get("timestamp", 0))) for r in local if isinstance(r, dict)}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                score = int(row.get("score", 0))
                ts = float(row.get("timestamp", 0))
                key = (score, ts)
                if key in seen:
                    continue
                local.append({"score": score, "timestamp": ts})
                seen.add(key)
                merged["records"] += 1
            local.sort(key=lambda item: int(item.get("score", 0)), reverse=True)
            if len(local) > 50:
                del local[50:]

    stages = payload.get("stages")
    if isinstance(stages, dict):
        for key, stage_payload in stages.items():
            if not isinstance(key, str) or not isinstance(stage_payload, dict):
                continue
            meta = stage_payload.get("meta") if isinstance(stage_payload.get("meta"), dict) else {}
            cfg = stage_payload.get("config") if isinstance(stage_payload.get("config"), dict) else {}
            name = str(meta.get("name") or key)
            password = str(meta.get("password") or "")
            locked = bool(meta.get("locked"))
            try:
                stage_store.save(key, name, cfg, password=password, locked=locked)
                merged["stages"] += 1
            except Exception:
                continue

    return merged


def fetch_peer_state(peer: str, shared_key: str, timeout_s: int = 4) -> dict[str, Any] | None:
    if not peer:
        return None
    base = peer.rstrip("/")
    query = urllib.parse.urlencode({"key": shared_key})
    url = f"{base}/api/cluster/export?{query}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("X-CNACTION-SYNC-KEY", shared_key)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    state = payload.get("state")
    return state if isinstance(state, dict) else None
