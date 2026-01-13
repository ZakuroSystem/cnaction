"""HTTP routes for the CNACTION web application."""
from __future__ import annotations

import time
from pathlib import Path

from flask import Blueprint, current_app, jsonify, render_template, request

from cnaction import game
from utils import export_config_response

from ..services.stage_store import StageStore
from ..services.uploads import UploadService
from ..settings import AppSettings


def _static_mtime(static_folder: Path, resource: str) -> int:
    try:
        target = static_folder / resource
        return int(target.stat().st_mtime)
    except OSError:
        return int(time.time())


def create_blueprint(stage_store: StageStore, upload_service: UploadService, settings: AppSettings) -> Blueprint:
    blueprint = Blueprint("core", __name__)

    @blueprint.route("/api/stages", methods=["GET", "POST"])
    def api_stages():
        if request.method == "GET":
            stages = [
                {"key": summary.key, "name": summary.name, "updated": summary.updated}
                for summary in stage_store.list()
            ]
            return jsonify(stages=stages)

        payload = request.get_json(force=True) or {}
        key = str(payload.get("key") or int(time.time()))
        name = str(payload.get("name") or key)
        config = payload.get("config") or {}
        try:
            stage_store.save(key, name, config)
        except ValueError as exc:
            return jsonify(ok=False, msg=str(exc)), 400
        except OSError as exc:
            return jsonify(ok=False, msg=str(exc)), 500
        return jsonify(ok=True, key=key)

    @blueprint.route("/api/stages/<key>")
    def api_stage_get(key: str):
        data = stage_store.load(key)
        if data is None:
            return jsonify(error="not found"), 404
        return jsonify(data)

    @blueprint.route("/api/default_config")
    def api_default_config():
        return jsonify(game.get_default_room_config())

    @blueprint.route("/upload_image", methods=["POST"])
    def upload_image():
        if request.form.get("password", "") != settings.upload_password:
            return jsonify(success=False, message="パスワードが違います"), 403

        item_name = request.form.get("item_name", "").strip()
        file = request.files.get("file")
        if not item_name or not file:
            return jsonify(success=False, message="必要項目が不足"), 400

        filename = f"{item_name}{Path(file.filename).suffix.lower()}"
        if not upload_service.is_allowed(filename):
            return jsonify(success=False, message="許可外拡張子"), 400

        try:
            destination = upload_service.save(file, filename)
        except ValueError as exc:
            return jsonify(success=False, message=str(exc)), 400
        static_root = Path(current_app.static_folder or "static")
        try:
            rel_path = destination.relative_to(static_root)
            public_path = f"/static/{rel_path.as_posix()}"
        except ValueError:
            public_path = destination.as_posix()
        return jsonify(success=True, path=public_path)

    @blueprint.route("/")
    def index():
        static_folder = Path(current_app.static_folder or "static")
        version = _static_mtime(static_folder, "main.js")
        return render_template("index.html", main_js_version=version)

    @blueprint.route("/editor")
    def editor():
        return render_template("editor.html")

    @blueprint.route("/admin")
    def admin():
        return render_template("admin.html")

    @blueprint.route("/admin_state")
    def admin_state():
        return jsonify({room: game.serialize_room_state(state) for room, state in game.rooms.items()})

    @blueprint.route("/export_config")
    def export_config():
        room = request.args.get("room", "")
        return export_config_response(room, game.rooms, game.get_default_room_config())

    @blueprint.route("/reset_room", methods=["POST"])
    def reset_room():
        room = request.form.get("room", "")
        if not game.reset_room(room):
            return "Room not found", 404
        return "Reset", 200

    @blueprint.route("/delete_room", methods=["POST"])
    def delete_room():
        room = request.form.get("room", "")
        if not game.delete_room(room):
            return "Room not found", 404
        return "Deleted", 200

    return blueprint


__all__ = ["create_blueprint"]
