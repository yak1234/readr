"""Inter-process file locks (fcntl.flock), so two server processes sharing data/ and models/ never
build the same dictionary or download the same models at once. The OS drops a lock when its
process dies, so a crash never leaves one stuck."""

from __future__ import annotations

import fcntl
import os
from pathlib import Path


def try_lock(path: Path) -> "int | None":
    """Take an exclusive lock without waiting; the file descriptor, or None if another holder has it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    return fd


def lock(path: Path) -> int:
    """Take an exclusive lock, waiting for the current holder."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o644)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


def unlock(fd: int) -> None:
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)
