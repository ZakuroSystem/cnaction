"""Background tasks used by the Socket.IO server."""
from __future__ import annotations

from flask_socketio import SocketIO

from cnaction import game
from utils import update_orders


def start_game_timer(socketio: SocketIO) -> None:
    """Launch the repeating task that ticks game timers."""

    def task() -> None:
        while True:
            socketio.sleep(1)
            for room in list(game.rooms.keys()):
                rs = game.rooms[room]
                if rs.clientManaged:
                    continue
                if rs.timer > 0:
                    rs.timer -= 1
                    if rs.timer <= 0:
                        rs.gameOver = True
                        game.clear_world_items(rs)
                update_orders(room, game.rooms)
                game.mark_dirty(room)
                if rs.gameOver and not rs.resetScheduled:
                    rs.resetScheduled = True
                    socketio.start_background_task(
                        lambda r=room: (socketio.sleep(10), game.delete_room(r))
                    )

    socketio.start_background_task(task)


__all__ = ["start_game_timer"]
