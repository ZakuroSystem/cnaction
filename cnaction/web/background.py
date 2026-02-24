"""Background tasks used by the Socket.IO server."""
from __future__ import annotations

from flask_socketio import SocketIO

from cnaction import game
from utils import update_orders
from ..settings import AppSettings
from ..services.stage_store import StageStore
from ..services.cluster_sync import fetch_peer_state, merge_cluster_state


def start_game_timer(socketio: SocketIO, settings: AppSettings, stage_store: StageStore) -> None:
    """Launch the repeating task that ticks game timers."""

    def task() -> None:
        while True:
            socketio.sleep(1)
            for room in list(game.rooms.keys()):
                rs = game.rooms[room]
                if rs.clientManaged:
                    continue
                was_game_over = bool(rs.gameOver)
                if rs.timer > 0:
                    rs.timer -= 1
                    if rs.timer <= 0:
                        rs.gameOver = True
                        game.clear_world_items(rs)
                if not was_game_over and rs.gameOver and game.room_persistence_enabled and game.is_room_persistent(room):
                    game.add_room_record(room, rs.score)
                timed_out_orders = update_orders(room, game.rooms)
                if timed_out_orders > 0:
                    socketio.emit(
                        'action_feedback',
                        {'deliveryResult': 'failure'},
                        room=room,
                    )
                game.mark_dirty(room)
                if rs.gameOver and not rs.resetScheduled:
                    rs.resetScheduled = True
                    socketio.start_background_task(
                        lambda r=room: (socketio.sleep(10), game.delete_room(r))
                    )

    socketio.start_background_task(task)

    def sync_task() -> None:
        while True:
            socketio.sleep(max(1, int(settings.cluster_sync_interval_sec)))
            if not settings.cluster_sync_enabled:
                continue
            shared_key = (settings.cluster_sync_key or "").strip()
            if len(shared_key) < 32:
                continue
            peers = [peer for peer in settings.cluster_sync_peers if isinstance(peer, str) and peer.strip()]
            for peer in peers:
                state = fetch_peer_state(peer, shared_key)
                if not isinstance(state, dict):
                    continue
                merge_cluster_state(state, stage_store, settings)

    socketio.start_background_task(sync_task)


__all__ = ["start_game_timer"]
