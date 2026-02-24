"""Flask application factory for the CNACTION project."""
from __future__ import annotations

from pathlib import Path
from typing import Tuple

from flask import Flask
from flask_socketio import SocketIO

from ..settings import AppSettings
from ..services.room_store import RoomStore
from ..services.stage_store import StageStore
from ..services.uploads import UploadService
from .background import start_game_timer
from .routes import create_blueprint
from .socketio_handlers import register_socketio_handlers

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if (PACKAGE_ROOT / "templates").exists() and (PACKAGE_ROOT / "static").exists():
    RESOURCE_ROOT = PACKAGE_ROOT
else:
    RESOURCE_ROOT = PACKAGE_ROOT.parent


def create_app(settings: AppSettings | None = None) -> Tuple[Flask, SocketIO]:
    """Create and configure the Flask + Socket.IO application."""

    settings = settings or AppSettings.from_env(project_root=RESOURCE_ROOT)

    app = Flask(
        __name__,
        static_folder=str(RESOURCE_ROOT / "static"),
        static_url_path="/static",
        template_folder=str(RESOURCE_ROOT / "templates"),
    )
    app.config["SECRET_KEY"] = settings.secret_key
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

    socketio = SocketIO(app, cors_allowed_origins="*")

    stage_store = StageStore(settings.stage_dir)
    room_store = RoomStore(settings.stage_dir / "rooms.json")
    upload_service = UploadService(
        settings.upload_dir,
        settings.backup_dir,
        allowed_extensions=settings.allowed_upload_extensions,
    )

    app.extensions["cnaction_settings"] = settings
    app.extensions["stage_store"] = stage_store
    app.extensions["room_store"] = room_store
    app.extensions["upload_service"] = upload_service

    app.register_blueprint(create_blueprint(stage_store, upload_service, settings))

    from cnaction import game

    game.init(socketio)
    game.set_room_persistence_enabled(settings.room_persistence_enabled)
    game.set_cluster_node_id(settings.cluster_node_id)
    game.set_room_store(room_store)
    for snapshot in room_store.load().values():
        game.initialize_room(snapshot.name, snapshot.config)
        if snapshot.name == settings.default_room:
            game.set_default_room_config(snapshot.config)
    register_socketio_handlers(socketio, settings)
    start_game_timer(socketio, settings, stage_store)

    return app, socketio


__all__ = ["create_app"]
