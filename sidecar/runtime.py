"""Where the helpers find what they run with, and which engines this computer can run.

Packaged, the models and dictionaries ship inside the app, read-only (Readr passes the folders in the
environment; see electron/runtime-paths.ts), and whatever is downloaded or written later goes to the user's
own folders. In development everything sits next to these scripts, as it always has.

This file and electron/runtime-paths.ts are the only places that name a platform. Support for another one
(Windows) is added here: a row in speech_runner, a case in translator_available.
"""
from __future__ import annotations

import logging
import os
import platform
import shutil
from pathlib import Path
from typing import Optional

HERE = Path(__file__).resolve().parent
log = logging.getLogger("readr")
# The speech runner Readr ships for each (system, machine): its folder name in development, and its device.
SPEECH_RUNNERS = {("Darwin", "arm64"): ("nemo-speech-0.3.0-macos-aarch64-metal", "metal")}


def languages_path() -> Path:
    """shared/languages.json: beside the sidecar folder, in the project and in the packaged app alike."""
    return HERE.parent / "shared" / "languages.json"


def bundled_stanza() -> Optional[Path]:
    """The Stanza models that ship with the app, if this is the packaged app."""
    value = os.environ.get("READR_BUNDLED_STANZA")
    return Path(value) if value else None


def stanza_dir(code: str, user: Path, marker: str, bundled: Optional[Path] = None) -> Path:
    """The folder holding `code`'s models: the app's own if it ships them complete, else the user's
    (where a language the app doesn't ship is downloaded)."""
    bundled = bundled if bundled is not None else bundled_stanza()
    if bundled is not None and (bundled / code / marker).exists():
        return bundled
    return user


def seed_dictionaries(data_dir: Path, seed: Optional[Path] = None) -> list[str]:
    """Copies the dictionaries that ship with the app into `data_dir`, leaving any already there alone
    (they may have been rebuilt since). Returns the names copied. One that can't be copied (a full disk)
    is skipped, with nothing left half-written: the helper still starts, and fetches it later as it would
    for any language the app doesn't ship."""
    if seed is None:
        value = os.environ.get("READR_DICTIONARY_SEED")
        seed = Path(value) if value else None
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        log.warning("the dictionaries folder %s can't be made: %s", data_dir, exc)
        return []
    if seed is None or not seed.is_dir():
        return []
    copied = []
    for source in sorted(seed.glob("*.sqlite")):
        target = data_dir / source.name
        if target.exists():
            continue
        partial = target.with_suffix(".sqlite.part")  # never a half-copied dictionary under the real name
        try:
            shutil.copyfile(source, partial)
            partial.replace(target)
        except OSError as exc:
            log.warning("the %s dictionary couldn't be copied from the app: %s", source.name, exc)
            partial.unlink(missing_ok=True)
            continue
        copied.append(source.name)
    return copied


def speech_runner(system: Optional[str] = None, machine: Optional[str] = None) -> Optional[tuple[Path, str]]:
    """(the NeMo-Speech.cpp program, the device it runs on) for this computer; None where Readr has none."""
    row = SPEECH_RUNNERS.get((system or platform.system(), machine or platform.machine()))
    if row is None:
        return None
    folder, device = row
    roots = [
        Path(os.environ["READR_SPEECH_RUNNER"]) if os.environ.get("READR_SPEECH_RUNNER") else None,
        HERE.parent / "runtime" / "speech",  # packaged: Resources/runtime/speech
        HERE / "nemo-speech" / "dist" / folder,  # development
    ]
    for root in roots:
        if root is not None and (root / "bin" / "nemo-speech").exists():
            return root / "bin" / "nemo-speech", device
    return None


def speech_model_args(folder: Optional[Path] = None) -> list[str]:
    """The runner's model arguments. Packaged, the models ship as plain files in READR_SPEECH_MODELS and are
    named by path: the runner then reads them where they are and writes nothing beside them (given names, it
    keeps a cache it must lock and write to, which a signed app can't hold). In development: by name, from the
    runner's own cache, downloaded on first use."""
    if folder is None:
        value = os.environ.get("READR_SPEECH_MODELS")
        folder = Path(value) if value else None
    if folder is None:
        return ["--tts-model", "magpie", "--asr-model", "nemotron-3.5"]
    return [
        "--tts-model", str(folder / "tts.gguf"),
        "--codec-model", str(folder / "codec.gguf"),
        "--tokenizer-dir", str(folder / "tokenizer"),
        "--asr-model", str(folder / "asr.gguf"),
    ]  # fmt: skip


def translator_available() -> Optional[str]:
    """None when this computer can run the translator; else what to tell the reader."""
    if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
        return "Translation isn't available on this computer yet (it needs an Apple Silicon Mac)."
    return None
