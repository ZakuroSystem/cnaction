"""HTTP routes for the CNACTION web application."""
from __future__ import annotations

import json
import time
from pathlib import Path

from flask import Blueprint, current_app, jsonify, render_template, request

from cnaction import game
from utils import export_config_response

from ..services.stage_store import StageStore
from ..services.uploads import UploadService
from ..services.cluster_sync import build_cluster_state, merge_cluster_state
from ..settings import AppSettings


_copy_rate_limit: dict[str, float] = {}


def _room_persistence_path(settings: AppSettings) -> Path:
    return settings.stage_dir / "room_persistence.json"


def _load_room_persistence(settings: AppSettings) -> dict:
    path = _room_persistence_path(settings)
    if not path.exists():
        return {"persistentRooms": [], "records": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"persistentRooms": [], "records": {}}
    if not isinstance(data, dict):
        return {"persistentRooms": [], "records": {}}
    rooms = data.get("persistentRooms")
    records = data.get("records")
    if not isinstance(rooms, list):
        rooms = []
    if not isinstance(records, dict):
        records = {}
    return {"persistentRooms": [r for r in rooms if isinstance(r, str)], "records": records}


def _save_room_persistence(settings: AppSettings) -> None:
    path = _room_persistence_path(settings)
    payload = {
        "persistentRooms": sorted(game.persistent_rooms),
        "records": game.room_records,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _static_mtime(static_folder: Path, resource: str) -> int:
    try:
        target = static_folder / resource
        return int(target.stat().st_mtime)
    except OSError:
        return int(time.time())




def _sync_authorized(req, settings: AppSettings) -> bool:
    if not settings.cluster_sync_enabled:
        return False
    expected = (settings.cluster_sync_key or "").strip()
    if len(expected) < 32:
        return False
    provided = req.headers.get("X-CNACTION-SYNC-KEY") or req.args.get("key") or ""
    return str(provided).strip() == expected

def create_blueprint(stage_store: StageStore, upload_service: UploadService, settings: AppSettings) -> Blueprint:
    blueprint = Blueprint("core", __name__)

    persisted = _load_room_persistence(settings)
    for room_name in persisted.get("persistentRooms", []):
        game.set_room_persistent(room_name, True)
    records = persisted.get("records", {})
    if isinstance(records, dict):
        for room_name, values in records.items():
            if not isinstance(room_name, str) or not isinstance(values, list):
                continue
            game.room_records[room_name] = [row for row in values if isinstance(row, dict)]


    @blueprint.route("/api/stages", methods=["GET", "POST"])
    def api_stages():
        if request.method == "GET":
            stages = [
                {
                    "key": summary.key,
                    "name": summary.name,
                    "updated": summary.updated,
                    "locked": summary.locked,
                    "persistent": game.is_room_persistent(summary.name),
                }
                for summary in stage_store.list()
            ]
            return jsonify(stages=stages)

        payload = request.get_json(force=True) or {}
        key = str(payload.get("key") or int(time.time()))
        name = str(payload.get("name") or key)
        config = payload.get("config") or {}
        password = str(payload.get("password") or "").strip()
        locked = bool(payload.get("locked", False))

        existing = stage_store.load(key)
        if existing:
            meta = existing.get("meta", {}) if isinstance(existing, dict) else {}
            if bool(meta.get("locked")) and password != str(meta.get("password") or ""):
                return jsonify(ok=False, msg="ロック中ステージのため、正しいパスワードが必要です"), 403

        try:
            stage_store.save(key, name, config, password=password, locked=locked)
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
        meta = data.get("meta", {}) if isinstance(data, dict) else {}
        if bool(meta.get("locked")):
            password = request.args.get("password", "")
            if password != str(meta.get("password") or ""):
                return jsonify(error="locked", msg="パスワードが必要です"), 403
        return jsonify(data)

    @blueprint.route("/api/stages/<key>/copy", methods=["POST"])
    def api_stage_copy(key: str):
        client_key = request.remote_addr or "global"
        now = time.time()
        last = _copy_rate_limit.get(client_key, 0.0)
        wait = 10.0 - (now - last)
        if wait > 0:
            return jsonify(ok=False, msg=f"コピーは10秒に1回までです。あと{int(wait) + 1}秒待ってください"), 429

        new_key = str(int(now * 1000))
        try:
            copied = stage_store.copy_as_new(key, new_key)
        except ValueError as exc:
            return jsonify(ok=False, msg=str(exc)), 404
        _copy_rate_limit[client_key] = now
        return jsonify(ok=True, **copied)

    @blueprint.route("/api/rooms/<room>/persist", methods=["POST"])
    def api_room_persist(room: str):
        if not settings.room_persistence_enabled:
            return jsonify(ok=False, msg="永続化機能は無効です"), 403
        normalized = (room or "").strip()
        if not normalized:
            return jsonify(ok=False, msg="ルーム名が必要です"), 400
        game.set_room_persistent(normalized, True)
        _save_room_persistence(settings)
        return jsonify(ok=True, room=normalized)

    @blueprint.route("/api/rooms/<room>/records")
    def api_room_records(room: str):
        normalized = (room or "").strip()
        if not normalized:
            return jsonify(ok=False, msg="ルーム名が必要です"), 400
        persistent = game.is_room_persistent(normalized)
        records = game.get_room_records(normalized)
        return jsonify(ok=True, room=normalized, persistent=persistent, records=records)

    @blueprint.route("/api/rooms/persistence_status")
    def api_room_persistence_status():
        return jsonify(enabled=bool(settings.room_persistence_enabled))

    @blueprint.route("/api/cluster/export")
    def api_cluster_export():
        if not _sync_authorized(request, settings):
            return jsonify(ok=False, msg="unauthorized"), 403
        return jsonify(ok=True, state=build_cluster_state(stage_store))

    @blueprint.route("/api/cluster/import", methods=["POST"])
    def api_cluster_import():
        if not _sync_authorized(request, settings):
            return jsonify(ok=False, msg="unauthorized"), 403
        payload = request.get_json(force=True) or {}
        state = payload.get("state") if isinstance(payload, dict) else None
        merged = merge_cluster_state(state if isinstance(state, dict) else {}, stage_store, settings)
        _save_room_persistence(settings)
        return jsonify(ok=True, merged=merged)

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
        static_folder = Path(current_app.static_folder or "static")
        stage_editor_version = _static_mtime(static_folder, "scripts/stage_editor.js")
        stage_manager_version = _static_mtime(static_folder, "scripts/stage_manager.js")
        return render_template(
            "editor.html",
            stage_editor_version=stage_editor_version,
            stage_manager_version=stage_manager_version,
        )

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
        game.set_room_persistent(room, False)
        _save_room_persistence(settings)
        return "Deleted", 200

    return blueprint


__all__ = ["create_blueprint"]
