"""Word analysis with Stanza: what a clicked word *is* (dictionary form, word type, grammar, clitic parts).

Stanza (Stanford, ~70 languages, one small model set per language) splits a written word such as
والمزارعين into و + مُزَارِع, or mettait into mettre. kaikki then says what the lemma means, and Hy-MT2
what it means in context.

* Pipelines load lazily, on the first analysis of a language, and at most MAX_LOADED (3) stay in memory;
  the least recently used one is dropped (and freed) when a fourth arrives.
* Models are downloaded once to MODEL_DIR (STANZA_RESOURCES_DIR overrides) and never fetched again.
  ensure_analysis(lang) downloads in the background with the same cooldown as dictionaries.ensure, and
  never for languages Stanza lacks. CORE languages are fetched ahead of time, to disk only.
"""

from __future__ import annotations

import gc
import json
import logging
import os
import sys
import threading
import time
import unicodedata
from collections import OrderedDict
from pathlib import Path

from typing import Optional

import hymt
import runtime
from locks import lock, try_lock, unlock

HERE = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("STANZA_RESOURCES_DIR") or HERE / "models" / "stanza")
MAX_LOADED = 3
SENTENCE_CACHE = 500
COOLDOWN = 600.0  # seconds before a failed download is retried
CORE = ("ar", "zh", "en", "fr", "ru", "es")  # fetched to disk ahead of time; memory stays lazy
CONTENT = ("NOUN", "VERB", "ADJ", "ADV", "PROPN")
READY_MARKER = ".readr-ready"

log = logging.getLogger("readr")

_lock = threading.RLock()
_pipelines: "OrderedDict[str, object]" = OrderedDict()
_load_locks: dict[str, threading.Lock] = {}
_run_lock = threading.Lock()  # Stanza pipelines are not re-entrant
_cache: "OrderedDict[tuple[str, str], list[dict]]" = OrderedDict()
_running: set[str] = set()
_failed: dict[str, float] = {}


def _now() -> float:
    return time.monotonic()


def _reset() -> None:
    with _lock:
        _pipelines.clear()
        _cache.clear()
        _running.clear()
        _failed.clear()
        _load_locks.clear()
    gc.collect()


def available() -> bool:
    """Is the stanza package installed?"""
    import importlib.util

    return importlib.util.find_spec("stanza") is not None


def stanza_code(lang: str) -> str:
    """Stanza's code for a Readr language code (Chinese is split into Simplified and Traditional)."""
    return "zh-hans" if lang == "zh" else lang.lower()


def loaded() -> list[str]:
    """Languages currently in memory, least recently used first."""
    with _lock:
        return list(_pipelines)


# --------------------------------------------------------------------------- models on disk


def _model_dir(lang: str) -> Path:
    """Where `lang`'s models are: shipped with the app (read-only), else MODEL_DIR (the user's, where a
    language the app doesn't ship is downloaded)."""
    return runtime.stanza_dir(stanza_code(lang), MODEL_DIR, READY_MARKER)


def _resources(folder: Optional[Path] = None) -> dict:
    """Stanza's list of what each language has, from `folder`; by default the user's, else the app's."""
    folders = [folder] if folder else [MODEL_DIR, runtime.bundled_stanza()]
    for candidate in folders:
        if candidate is None:
            continue
        try:
            return json.loads((candidate / "resources.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    return {}


def processors_for(resources: dict, code: str) -> str:
    """Stanza processors for a language: mwt (multi-word tokens) only where Stanza has a model for it."""
    entry = resources.get(code) or {}
    while "alias" in entry:  # e.g. "no" -> "nb"
        entry = resources.get(entry["alias"]) or {}
    return ",".join(p for p in ("tokenize", "mwt", "pos", "lemma") if p in entry)


def _supported(lang: str) -> bool:
    """Does Stanza have models for `lang`? Optimistic until resources.json has been fetched once."""
    resources = _resources()
    if not resources:
        return True
    procs = processors_for(resources, stanza_code(lang)).split(",")
    return "tokenize" in procs and "pos" in procs


def _marker(lang: str) -> Path:
    return _model_dir(lang) / stanza_code(lang) / READY_MARKER


def model_ready(lang: str) -> bool:
    """True once a download finished completely (a half-downloaded folder never counts)."""
    return _marker(lang).exists()


def mark_ready(lang: str) -> None:
    marker = MODEL_DIR / stanza_code(lang) / READY_MARKER  # downloads only ever land in the user's folder
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.touch()


def _download(lang: str) -> None:
    import stanza

    code = stanza_code(lang)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    # The first call also fetches resources.json, which says which other models the language has
    # (mwt exists only for some languages, and requesting a missing one is an error).
    stanza.download(code, model_dir=str(MODEL_DIR), processors="tokenize,pos", verbose=False)
    procs = processors_for(_resources(MODEL_DIR), code)
    if procs != "tokenize,pos":
        stanza.download(code, model_dir=str(MODEL_DIR), processors=procs, verbose=False)


def _job(lang: str) -> None:
    fd = None
    try:
        # One download at a time across processes; whoever waited re-checks what the other fetched.
        fd = lock(MODEL_DIR / ".download.lock")
        if not model_ready(lang):
            if not _supported(lang):
                raise LookupError(f"Stanza has no models for {lang}")
            _download(lang)
            mark_ready(lang)
            log.info("analysis models ready: %s", lang)
    except Exception as exc:  # noqa: BLE001 - offline, missing language: retried after COOLDOWN
        log.warning("analysis download for %s failed: %s", lang, exc)
        with _lock:
            _failed[lang] = _now()
    finally:
        with _lock:
            _running.discard(lang)
        if fd is not None:
            unlock(fd)


def ensure_analysis(lang: str) -> str:
    """"ready" | "downloading" | "unavailable". Idempotent: one download per language at a time."""
    if lang not in hymt.languages() or not _supported(lang):
        return "unavailable"
    if model_ready(lang):
        return "ready"
    with _lock:
        if lang in _running:
            return "downloading"
        if lang in _failed and _now() - _failed[lang] < COOLDOWN:
            return "unavailable"
        _failed.pop(lang, None)
        _running.add(lang)
    threading.Thread(target=_job, args=(lang,), daemon=True, name=f"stanza-{lang}").start()
    return "downloading"


def predownload_core() -> threading.Thread:
    """Fetch the core languages' models to disk, one after another, in the background. Disk only."""

    def run() -> None:
        core = try_lock(MODEL_DIR / ".core.lock")
        if core is None:  # another process is already fetching the core set
            return
        try:
            _fetch_core()
        finally:
            unlock(core)

    def _fetch_core() -> None:
        for lang in CORE:
            if model_ready(lang):
                continue
            with _lock:
                if lang in _running or (lang in _failed and _now() - _failed[lang] < COOLDOWN):
                    continue
                _failed.pop(lang, None)
                _running.add(lang)
            _job(lang)  # synchronous here: one model set at a time

    t = threading.Thread(target=run, daemon=True, name="stanza-core")
    t.start()
    return t


# --------------------------------------------------------------------------- pipelines


_threads_set = False


def torch_threads() -> int:
    """Threads torch may use: a few, so Stanza doesn't fight MLX translation and the ASR runner for cores."""
    return max(1, min(4, (os.cpu_count() or 2) // 2))


def configure_torch() -> None:
    """Bound torch's thread pools once (before the first pipeline runs)."""
    global _threads_set
    if _threads_set:
        return
    import torch  # an ImportError leaves _threads_set False, so the next load tries again

    torch.set_num_threads(torch_threads())
    try:
        torch.set_num_interop_threads(1)  # raises if parallel work already started
    except RuntimeError as exc:
        log.warning("could not bound torch interop threads: %s", exc)
    _threads_set = True


def live_torch_threads() -> int:
    """torch's actual intra-op thread count once it is loaded; before that, the bound it will be given."""
    # While torch is still being imported (on another thread) it is in sys.modules without its functions yet.
    count = getattr(sys.modules.get("torch"), "get_num_threads", None)
    return count() if count is not None else torch_threads()


def _build_pipeline(lang: str):
    import stanza

    configure_torch()

    code = stanza_code(lang)
    folder = _model_dir(lang)
    return stanza.Pipeline(
        lang=code,
        dir=str(folder),
        processors=processors_for(_resources(folder), code),
        download_method=None,  # never fetch here; ensure_analysis owns downloads
        use_gpu=False,
        verbose=False,
    )


def _free() -> None:
    gc.collect()
    torch = sys.modules.get("torch")  # only if Stanza has loaded it
    try:
        if torch is not None and torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except Exception:  # noqa: BLE001 - freeing is best effort
        pass


def _pipeline(lang: str):
    with _lock:
        p = _pipelines.get(lang)
        if p is not None:
            _pipelines.move_to_end(lang)
            return p
        load = _load_locks.setdefault(lang, threading.Lock())
    with load:  # one load per language at a time
        with _lock:
            p = _pipelines.get(lang)
            if p is not None:
                _pipelines.move_to_end(lang)
                return p
        p = _build_pipeline(lang)
        dropped = []
        with _lock:
            _pipelines[lang] = p
            while len(_pipelines) > MAX_LOADED:
                dropped.append(_pipelines.popitem(last=False))
        if dropped:
            log.info("analysis models freed: %s", ", ".join(k for k, _ in dropped))
            del dropped
            _free()
        return p


def warm(lang: str) -> threading.Thread:
    """Load `lang`'s pipeline in the background (only if its models are on disk)."""

    def run() -> None:
        if model_ready(lang):
            try:
                _pipeline(lang)
            except Exception as exc:  # noqa: BLE001 - warming is an optimisation
                log.warning("warming %s failed: %s", lang, exc)

    t = threading.Thread(target=run, daemon=True, name=f"warm-{lang}")
    t.start()
    return t


# --------------------------------------------------------------------------- analysis


def analyse(sentence: str, lang: str) -> list[dict]:
    """Tokens of `sentence`: {text, start, end, parts: [{text, lemma, upos, feats}]}.

    Returns [] when the language's models aren't on disk (use ensure_analysis to fetch them)."""
    key = (lang, sentence)
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    if not sentence.strip() or not model_ready(lang):
        return []
    pipeline = _pipeline(lang)
    # Stanza only splits clitics (Arabic و/ب/ال, French du...) in a word that is not the very last thing
    # in the text, so an unpunctuated sentence (a lone clicked word, a radio line) gets a full stop.
    text = sentence if unicodedata.category(sentence.rstrip()[-1]).startswith("P") else f"{sentence} ."
    with _run_lock:
        doc = pipeline(text)
    tokens = [
        {
            "text": t.text,
            "start": t.start_char,
            "end": t.end_char,
            "parts": [
                {"text": w.text, "lemma": w.lemma or w.text, "upos": w.upos or "", "feats": w.feats}
                for w in t.words
            ],
        }
        for s in doc.sentences
        for t in s.tokens
        if t.start_char < len(sentence)  # not the full stop added above
    ]
    with _lock:
        _cache[key] = tokens
        while len(_cache) > SENTENCE_CACHE:
            _cache.popitem(last=False)
    return tokens


def pick_part(token: dict) -> dict:
    """The part a learner means: the first noun, verb, adjective, adverb or proper noun; else the longest."""
    parts = token["parts"]
    return next((p for p in parts if p["upos"] in CONTENT), None) or max(parts, key=lambda p: len(p["text"]))
