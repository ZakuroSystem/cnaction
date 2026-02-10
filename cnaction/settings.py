"""Runtime settings for the CNACTION web application."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, MutableMapping, Set

DEFAULT_STAGE_DIR = Path("stages")
DEFAULT_UPLOAD_DIR = Path("static/assets/ingredient")
DEFAULT_BACKUP_DIR = Path("static/assets/backup")
DEFAULT_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif"}


def _resolve_path(path: Path | str, *, base: Path) -> Path:
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = base / candidate
    return candidate


@dataclass(frozen=True, slots=True)
class AppSettings:
    """Configuration container used by the Flask application factory."""

    secret_key: str = "change-me"
    stage_dir: Path = DEFAULT_STAGE_DIR
    upload_dir: Path = DEFAULT_UPLOAD_DIR
    backup_dir: Path = DEFAULT_BACKUP_DIR
    upload_password: str = "1234"
    allowed_upload_extensions: Set[str] = field(default_factory=lambda: set(DEFAULT_ALLOWED_EXTENSIONS))
    default_room: str = "room1"
    auto_match_max_players: int = 4

    @classmethod
    def from_env(
        cls,
        env: Iterable[tuple[str, str]] | Mapping[str, str] | None = None,
        *,
        project_root: Path | None = None,
    ) -> "AppSettings":
        """Create settings from environment variables."""

        values: MutableMapping[str, str] = dict(env or {})
        base = project_root or Path.cwd()

        secret_key_default = cls.__dataclass_fields__["secret_key"].default
        upload_password_default = cls.__dataclass_fields__["upload_password"].default
        default_room_default = cls.__dataclass_fields__["default_room"].default
        auto_match_default = cls.__dataclass_fields__["auto_match_max_players"].default

        secret_key = values.get("CNACTION_SECRET_KEY", secret_key_default)
        upload_password = values.get("CNACTION_UPLOAD_PASSWORD", upload_password_default)
        default_room = values.get("CNACTION_DEFAULT_ROOM", default_room_default)
        auto_match_raw = values.get("CNACTION_AUTOMATCH_MAX_PLAYERS")
        if auto_match_raw is not None:
            try:
                auto_match_max_players = int(auto_match_raw)
            except ValueError:
                auto_match_max_players = auto_match_default
        else:
            auto_match_max_players = auto_match_default

        def _path(var: str, default: Path) -> Path:
            raw = values.get(var)
            return _resolve_path(Path(raw) if raw else default, base=base)

        stage_dir = _path("CNACTION_STAGE_DIR", DEFAULT_STAGE_DIR)
        upload_dir = _path("CNACTION_UPLOAD_DIR", DEFAULT_UPLOAD_DIR)
        backup_dir = _path("CNACTION_BACKUP_DIR", DEFAULT_BACKUP_DIR)

        extensions = values.get("CNACTION_ALLOWED_EXTENSIONS")
        if extensions:
            allowed = {
                ext.strip().lower() if ext.startswith(".") else f".{ext.strip().lower()}"
                for ext in extensions.split(",")
                if ext.strip()
            }
        else:
            allowed = set(DEFAULT_ALLOWED_EXTENSIONS)

        return cls(
            secret_key=secret_key,
            stage_dir=stage_dir,
            upload_dir=upload_dir,
            backup_dir=backup_dir,
            upload_password=upload_password,
            allowed_upload_extensions=allowed,
            default_room=default_room,
            auto_match_max_players=auto_match_max_players,
        )


__all__ = ["AppSettings", "DEFAULT_ALLOWED_EXTENSIONS"]
