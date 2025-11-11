"""Utilities for handling asset uploads."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Iterable

from werkzeug.datastructures import FileStorage


class UploadService:
    """Persist uploaded ingredient images with backups."""

    def __init__(self, upload_dir: Path, backup_dir: Path, *, allowed_extensions: Iterable[str]):
        self.upload_dir = upload_dir
        self.backup_dir = backup_dir
        self.allowed_extensions = {ext.lower() for ext in allowed_extensions}
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)

    def is_allowed(self, filename: str) -> bool:
        ext = Path(filename).suffix.lower()
        return ext in self.allowed_extensions

    def save(self, file: FileStorage, destination_name: str) -> Path:
        ext = Path(destination_name).suffix.lower()
        if ext not in self.allowed_extensions:
            raise ValueError("Unsupported file extension")

        safe_name = Path(destination_name).name.replace("..", "_")
        destination = self.upload_dir / safe_name

        if destination.exists():
            backup_name = (
                f"{destination.stem}_{int(destination.stat().st_mtime)}{destination.suffix}"
            )
            shutil.copy2(destination, self.backup_dir / backup_name)

        file.save(destination)
        return destination


__all__ = ["UploadService"]
