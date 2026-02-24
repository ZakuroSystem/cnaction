"""Socket.IO event registrations."""
from __future__ import annotations

import time
from typing import Any

from flask import request
from flask_socketio import SocketIO, join_room, leave_room

from cnaction import game
from cnaction.config import sanitize_config
from models import Player
from utils import parse_transfer_objects

from ..settings import AppSettings


def register_socketio_handlers(socketio: SocketIO, settings: AppSettings) -> None:
    default_room = settings.default_room
    auto_match_max_players = settings.auto_match_max_players

    def emit_sound_effect(effect: str) -> None:
        if not effect:
            return
        socketio.emit("action_feedback", {"soundEffect": effect}, room=request.sid)

    @socketio.on("join")
    def on_join(data: dict[str, Any] | None):
        payload = data if isinstance(data, dict) else {}
        raw_room = payload.get("room")
        auto_match = bool(payload.get("autoMatch"))
        preferred = payload.get("preferredRoom")
        default_name = default_room if isinstance(default_room, str) else "room1"
        if not isinstance(raw_room, str) or not raw_room.strip():
            raw_room = default_name
        room = raw_room.strip() or default_name
        if auto_match:
            preferred_name = None
            if isinstance(preferred, str):
                preferred_name = preferred.strip() or None
            room = game.resolve_auto_match_room(
                preferred=preferred_name,
                max_players=auto_match_max_players,
            )
        elif room not in game.rooms:
            game.initialize_room(room)
        join_room(room)
        rs = game.rooms[room]
        next_index = 1
        while f"player{next_index}" in rs.players:
            next_index += 1
        pid = f"player{next_index}"
        sprite_index = ((next_index - 1) % 4) + 1
        sprite_key = f"player{sprite_index}"
        rs.players[pid] = Player(base_image=sprite_key, image=sprite_key)
        game.sid_to_player[request.sid] = (room, pid)
        rs.hostId = ""
        rs.clientManaged = False
        game.mark_dirty(room)
        player = rs.players[pid]
        return {
            "playerId": pid,
            "isHost": False,
            "clientManaged": rs.clientManaged,
            "x": player.x,
            "y": player.y,
            "room": room,
        }

    @socketio.on("disconnect")
    def on_disconnect(reason: Any | None = None):
        info = game.sid_to_player.pop(request.sid, None)
        if not info:
            return
        room, pid = info
        if room in game.rooms and pid in game.rooms[room].players:
            game.rooms[room].players.pop(pid)
            rs = game.rooms[room]
            if rs.hostId == pid:
                rs.hostId = ""
                rs.clientManaged = False
            if not rs.players:
                game.reset_room(room)
                return
            game.mark_dirty(room)

    @socketio.on("leave")
    def on_leave(data: dict[str, Any] | None = None):
        info = game.sid_to_player.pop(request.sid, None)
        if not info:
            return
        room, pid = info
        leave_room(room)
        if room in game.rooms and pid in game.rooms[room].players:
            game.rooms[room].players.pop(pid)
            rs = game.rooms[room]
            if rs.hostId == pid:
                rs.hostId = ""
                rs.clientManaged = False
            if not rs.players:
                game.reset_room(room)
                return
            game.mark_dirty(room)

    @socketio.on("update_config")
    def on_update_config(data: dict[str, Any]):
        room = data.get("room")
        cfg = data.get("config")
        if room not in game.rooms:
            game.initialize_room(room, cfg)
            if room == default_room:
                cfg = sanitize_config(cfg)
                if isinstance(cfg.get("transferObjects"), str):
                    cfg["transferObjects"] = parse_transfer_objects(cfg["transferObjects"])
                game.set_default_room_config(cfg)
            return

        cfg = sanitize_config(cfg)
        if isinstance(cfg.get("transferObjects"), str):
            cfg["transferObjects"] = parse_transfer_objects(cfg["transferObjects"])
        game.assign_room_config(game.rooms[room], cfg)
        if room == default_room:
            game.set_default_room_config(cfg)
        game.mark_dirty(room)

    @socketio.on("move")
    def on_move(data: dict[str, Any]):
        room = data.get("room")
        pid = data.get("playerId")
        if room not in game.rooms or pid not in game.rooms[room].players:
            return
        rs = game.rooms[room]
        player = rs.players[pid]
        try:
            nx = float(data.get("x"))
            ny = float(data.get("y"))
        except (TypeError, ValueError):
            return

        seq = data.get("seq")
        try:
            seq_val = int(seq)
        except (TypeError, ValueError):
            seq_val = None

        last_seq = getattr(player, "lastMoveSeq", 0)
        if seq_val is not None and seq_val <= last_seq:
            return

        player.x = nx
        player.y = ny
        if player.currentItem:
            player.currentItem.x = nx
            player.currentItem.y = ny
        if seq_val is not None:
            player.lastMoveSeq = seq_val
        if rs.clientManaged:
            payload = {
                "playerId": pid,
                "room": room,
                "x": player.x,
                "y": player.y,
            }
            if seq_val is not None:
                payload["seq"] = seq_val
            socketio.emit("client_move", payload, room=room)
        game.mark_dirty(room)

        ack = {
            "playerId": pid,
            "room": room,
            "seq": getattr(player, "lastMoveSeq", seq_val or 0),
            "x": player.x,
            "y": player.y,
            "serverTime": time.time(),
        }
        socketio.emit("move_ack", ack, room=request.sid)

    @socketio.on("interact")
    def on_interact(data: dict[str, Any]):
        room = data.get("room")
        pid = data.get("playerId")
        if room not in game.rooms or pid not in game.rooms[room].players:
            return
        rs = game.rooms[room]
        player = game.rooms[room].players[pid]

        action_seq = data.get("actionSeq")
        try:
            action_seq_val = int(action_seq)
        except (TypeError, ValueError):
            action_seq_val = None

        last_action_seq = getattr(player, "lastActionSeq", 0)
        if action_seq_val is not None and action_seq_val <= last_action_seq:
            return

        def finalize(state_changed: bool = False, immediate: bool | None = None) -> None:
            ack_updated = False
            if action_seq_val is not None:
                player.lastActionSeq = action_seq_val
                ack_updated = True
            if state_changed or ack_updated:
                should_flush_immediately = state_changed if immediate is None else bool(immediate)
                game.mark_dirty(room, immediate=should_flush_immediately)

        if rs.clientManaged:
            payload = {
                "playerId": pid,
                "room": room,
                "x": data.get("x"),
                "y": data.get("y"),
            }
            if action_seq_val is not None:
                payload["actionSeq"] = action_seq_val
            socketio.emit("client_interact", payload, room=room)
            finalize(False)
            return

        x, y = player.x, player.y
        position_updated = False
        if "x" in data and "y" in data:
            try:
                nx = float(data.get("x"))
                ny = float(data.get("y"))
            except (TypeError, ValueError):
                nx = ny = None
            if nx is not None and ny is not None:
                player.x = nx
                player.y = ny
                if player.currentItem:
                    player.currentItem.x = nx
                    player.currentItem.y = ny
                x, y = nx, ny
                position_updated = True

        if player.currentItem is None:
            if game.try_pickup_world_item(rs, room, player, x, y):
                emit_sound_effect("pick")
                finalize(True)
                return
            if game.try_spawn_from_generator(rs, player, x, y):
                emit_sound_effect("pick")
                finalize(True)
                return
            finalize(position_updated, immediate=False)
            return

        item = player.currentItem
        action_info = game.resolve_cooking_action(rs, item)
        if action_info and game.start_cooking_action(room, rs, player, x, y, item, action_info):
            emit_sound_effect("cut" if action_info.get("action") == "cut" else "grill")
            finalize(True)
            return

        if isinstance(rs.config, dict):
            for zone in rs.config.get("actionZones") or []:
                if not isinstance(zone, dict):
                    continue
                if not game.in_zone(x, y, zone):
                    continue
                zone_action = zone.get("action")
                if zone_action in ("cut", "bake"):
                    emit_sound_effect("dismatch")
                    break

        delivered, success = game.try_deliver_item(rs, player, x, y)
        if delivered:
            socketio.emit(
                'action_feedback',
                {'deliveryResult': 'success' if success else 'failure'},
                room=request.sid,
            )
            finalize(True)
            return

        item.x = x
        item.y = y

        combined, feedback_message = game.try_stack_combination(rs, room, player, item)
        if feedback_message:
            socketio.emit('action_feedback', {'message': feedback_message, 'soundEffect': 'dismatch'}, room=request.sid)
        if combined:
            emit_sound_effect("marge")
            finalize(True)
            return

        game.drop_item_to_world(rs, room, player, item, x, y)
        emit_sound_effect("pick")
        finalize(True)

    @socketio.on("client_state")
    def on_client_state(data: dict[str, Any]):
        room = data.get("room")
        pid = data.get("playerId")
        if room not in game.rooms or pid not in game.rooms[room].players:
            return
        rs = game.rooms[room]
        if not rs.clientManaged:
            return
        if rs.hostId and rs.hostId != pid:
            return
        snapshot = data.get("state")
        if not isinstance(snapshot, dict):
            return
        if not rs.hostId:
            rs.hostId = pid
        game.apply_client_state(room, snapshot)
        game.mark_dirty(room)

    @socketio.on("request_state")
    def on_request_state(data: dict[str, Any]):
        room = data.get("room")
        if room not in game.rooms:
            return {"state": None, "serverTime": time.time()}
        state = game.serialize_room_state(game.rooms[room], include_positions=True)
        state["serverTime"] = time.time()
        return {"state": state, "serverTime": state["serverTime"]}

    @socketio.on("request_positions")
    def on_request_positions(data: dict[str, Any]):
        room = data.get("room")
        if room not in game.rooms:
            return {"players": {}, "serverTime": time.time()}
        player_ids = data.get("players")
        if not isinstance(player_ids, (list, tuple, set)):
            player_ids = None
        positions = game.get_player_positions(room, player_ids)
        return {"players": positions, "serverTime": time.time()}


__all__ = ["register_socketio_handlers"]
