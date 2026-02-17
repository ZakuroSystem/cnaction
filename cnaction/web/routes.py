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

    @blueprint.route("/api/particles", methods=["GET"])
    def api_particles_list():
        static_root = Path(current_app.static_folder or "static")
        particle_dir = static_root / "particles"
        particle_dir.mkdir(parents=True, exist_ok=True)
        items = []
        for path in sorted(particle_dir.glob("particle_*.gif")):
            stem = path.stem
            try:
                number = int(stem.split("_", 1)[1])
            except (ValueError, IndexError):
                continue
            items.append({"number": number, "name": path.name, "path": f"/static/particles/{path.name}"})
        items.sort(key=lambda item: item["number"])
        return jsonify(items=items)

    @blueprint.route("/api/particles", methods=["POST"])
    def api_particles_upload():
        file = request.files.get("file")
        if not file:
            return jsonify(ok=False, msg="GIFファイルが必要です"), 400
        ext = Path(file.filename or "").suffix.lower()
        if ext != ".gif":
            return jsonify(ok=False, msg="GIFのみアップロード可能です"), 400
        try:
            number = int(request.form.get("number", "0"))
        except ValueError:
            return jsonify(ok=False, msg="番号は整数で指定してください"), 400
        if number <= 0:
            return jsonify(ok=False, msg="番号は1以上で指定してください"), 400

        static_root = Path(current_app.static_folder or "static")
        particle_dir = static_root / "particles"
        particle_dir.mkdir(parents=True, exist_ok=True)
        destination = particle_dir / f"particle_{number}.gif"
        file.save(destination)
        return jsonify(ok=True, item={"number": number, "name": destination.name, "path": f"/static/particles/{destination.name}"})

    @blueprint.route("/api/particles/reindex", methods=["POST"])
    def api_particles_reindex():
        payload = request.get_json(force=True) or {}
        try:
            src_number = int(payload.get("from"))
            dst_number = int(payload.get("to"))
        except (TypeError, ValueError):
            return jsonify(ok=False, msg="番号は整数で指定してください"), 400
        if src_number <= 0 or dst_number <= 0:
            return jsonify(ok=False, msg="番号は1以上で指定してください"), 400

        static_root = Path(current_app.static_folder or "static")
        particle_dir = static_root / "particles"
        particle_dir.mkdir(parents=True, exist_ok=True)
        src = particle_dir / f"particle_{src_number}.gif"
        dst = particle_dir / f"particle_{dst_number}.gif"
        if not src.exists():
            return jsonify(ok=False, msg="変更元GIFが見つかりません"), 404
        if dst.exists():
            dst.unlink()
        src.rename(dst)
        return jsonify(ok=True)

    @blueprint.route("/api/particles/<int:number>", methods=["DELETE"])
    def api_particles_delete(number: int):
        if number <= 0:
            return jsonify(ok=False, msg="番号は1以上で指定してください"), 400
        static_root = Path(current_app.static_folder or "static")
        particle_dir = static_root / "particles"
        target = particle_dir / f"particle_{number}.gif"
        if not target.exists():
            return jsonify(ok=False, msg="対象GIFが見つかりません"), 404
        target.unlink()
        return jsonify(ok=True)

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
