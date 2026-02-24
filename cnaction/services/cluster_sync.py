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
    room_states: dict[str, dict] = {}

    for room, rs in game.rooms.items():
        cfg = rs.config if isinstance(rs.config, dict) else None
        if not isinstance(cfg, dict):
            continue
        sync = game.get_room_sync_info(room)
        rooms[room] = {
            "config": copy.deepcopy(cfg),
            "updatedAt": float(sync.get("updatedAt") or 0.0),
            "source": str(sync.get("source") or "Server"),
        }
        room_states[room] = {
            "state": game.serialize_room_state(rs, include_positions=True),
            "updatedAt": float(sync.get("updatedAt") or 0.0),
            "source": str(sync.get("source") or "Server"),
        }

    stages: dict[str, dict] = {}
    for summary in stage_store.list():
        loaded = stage_store.load(summary.key)
        if isinstance(loaded, dict):
            stages[summary.key] = loaded

    return {
        "generatedAt": time.time(),
        "rooms": rooms,
        "roomStates": room_states,
        "persistentRooms": sorted(game.persistent_rooms),
        "roomRecords": copy.deepcopy(game.room_records),
        "stages": stages,
    }


def _next_branch_name(base: str, source: str) -> str:
    safe_source = "".join(ch if ch.isalnum() or ch in ("_", "-") else "_" for ch in str(source or "Server"))
    safe_source = safe_source[:32] or "Server"
    idx = 1
    while True:
        candidate = f"{base}_{safe_source}_{idx}"
        if candidate not in game.rooms:
            return candidate
        idx += 1


def merge_cluster_state(payload: dict[str, Any], stage_store: StageStore, settings: AppSettings) -> dict[str, int]:
    merged = {"rooms": 0, "records": 0, "stages": 0}
    if not isinstance(payload, dict):
        return merged

    rooms = payload.get("rooms")
    if isinstance(rooms, dict):
        for room, wrapper in rooms.items():
            if not isinstance(room, str) or not isinstance(wrapper, dict):
                continue
            cfg = wrapper.get("config") if isinstance(wrapper.get("config"), dict) else None
            if not isinstance(cfg, dict):
                continue

            incoming_ts = float(wrapper.get("updatedAt") or 0.0)
            incoming_source = str(wrapper.get("source") or "Server")
            local_sync = game.get_room_sync_info(room)
            local_ts = float(local_sync.get("updatedAt") or 0.0)
            local_source = str(local_sync.get("source") or "Server")

            if room in game.rooms:
                local_cfg = game.rooms[room].config if isinstance(game.rooms[room].config, dict) else {}
                if local_cfg != cfg and local_source != incoming_source and local_ts > 0 and incoming_ts > 0:
                    # divergent edits during partition: keep both timelines
                    branch_name = _next_branch_name(room, incoming_source)
                    game.initialize_room(branch_name, copy.deepcopy(cfg))
                    game.touch_room_sync(branch_name, source=incoming_source, updated_at=incoming_ts)
                    game.mark_dirty(branch_name)
                    merged["rooms"] += 1
                    continue
                if incoming_ts and local_ts and incoming_ts < local_ts:
                    continue
                game.assign_room_config(game.rooms[room], copy.deepcopy(cfg))
            else:
                game.initialize_room(room, copy.deepcopy(cfg))

            game.touch_room_sync(room, source=incoming_source, updated_at=incoming_ts or time.time())
            game.mark_dirty(room)
            merged["rooms"] += 1

    room_states = payload.get("roomStates")
    if isinstance(room_states, dict):
        for room, wrapper in room_states.items():
            if not isinstance(room, str) or not isinstance(wrapper, dict):
                continue
            state = wrapper.get("state") if isinstance(wrapper.get("state"), dict) else None
            if not isinstance(state, dict):
                continue

            incoming_ts = float(wrapper.get("updatedAt") or 0.0)
            incoming_source = str(wrapper.get("source") or "Server")
            local_ts = float(game.get_room_sync_info(room).get("updatedAt") or 0.0)
            if incoming_ts and local_ts and incoming_ts < local_ts:
                continue

            if room not in game.rooms:
                cfg = state.get("config") if isinstance(state.get("config"), dict) else game.get_default_room_config()
                game.initialize_room(room, copy.deepcopy(cfg))

            game.apply_client_state(room, state)
            if room in game.rooms:
                game.rooms[room].clientManaged = False
            game.touch_room_sync(room, source=incoming_source, updated_at=incoming_ts or time.time())
            game.mark_dirty(room)

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
