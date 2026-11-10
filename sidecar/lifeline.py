"""Stops a helper when Readr goes away.

Readr starts each helper with its input connected to itself and READR_LIFELINE=1. When Readr ends, however
it ends, that input closes; the helper sees it and stops, so none is left running behind (holding gigabytes
of models and a port). A helper started by hand has no lifeline and runs until it is stopped. This works the
same on macOS and Windows.
"""
from __future__ import annotations

import os
import sys
import threading
from typing import Callable, Optional


def watch(on_end: Optional[Callable[[], None]] = None) -> bool:
    """Starts watching if Readr asked for it; `on_end` runs just before the helper stops."""
    if os.environ.get("READR_LIFELINE") != "1":
        return False

    def wait() -> None:
        try:
            while sys.stdin.buffer.read(4096):
                pass
        except Exception:  # noqa: BLE001 - an input that can't be read is a Readr that is gone
            pass
        try:
            if on_end:
                on_end()
        finally:
            os._exit(0)

    threading.Thread(target=wait, name="lifeline", daemon=True).start()
    return True
