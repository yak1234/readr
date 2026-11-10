"""Per-language dictionaries, downloaded from kaikki.org on first use.

kaikki.org serves one Wiktextract JSONL per language (English glosses), gzipped (~15x smaller):

  https://kaikki.org/dictionary/<Language>/kaikki.org-dictionary-<Language>.jsonl.gz

e.g. .../Arabic/kaikki.org-dictionary-Arabic.jsonl.gz (72 MB, against 868 MB raw). <Language> is the
English name from shared/languages.json.

ensure(lang) starts a background job that streams the HTTP response through a gunzip straight into
build_dict.build() (so no raw file is ever stored). build() writes <lang>-en.sqlite.building and renames
it when complete, so a half-built file is never mistaken for a dictionary. A download only counts if the
body length equals Content-Length and the gzip stream reached its end-of-stream marker: an HTTP client
can swallow a dropped connection as a clean end of input, which must not publish a truncated dictionary.

A dictionary without the build's meta(complete=1) marker (built before verification existed) counts as
missing and is rebuilt once; the old file stays readable until the new one replaces it.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
import zlib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator

import build_dict
import hymt
import runtime
from locks import try_lock, unlock

HERE = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("READR_DATA_DIR") or HERE / "data")
URL = "https://kaikki.org/dictionary/{name}/kaikki.org-dictionary-{name}.jsonl.gz"

log = logging.getLogger("readr")


class Unavailable(Exception):
    """kaikki has no dictionary for this language (or it can't be fetched)."""


_lock = threading.Lock()
_running: set[str] = set()
_failed: dict[str, float] = {}  # lang -> time of the last failure
COOLDOWN = 600.0  # seconds before a failed download is retried
# Too big to fetch unasked (multi-GB); English lookups use the machine gloss only.
NO_AUTO_DOWNLOAD = {"en"}


class IncompleteDownload(Exception):
    """The download ended early: a dropped connection, a length mismatch or a cut-off gzip stream."""


def _now() -> float:
    return time.monotonic()


def _reset() -> None:
    with _lock:
        _running.clear()
        _failed.clear()


def dict_path(lang: str) -> Path:
    if lang not in hymt.languages():  # also keeps "../x" away from the filesystem
        raise ValueError(f"unknown language {lang!r}")
    return DATA_DIR / f"{lang}-en.sqlite"


class GzipLines:
    """Lines of text from gzip-compressed byte chunks, verified as they end.

    Iterating raises IncompleteDownload unless the total bytes equal `expected_length` (when known) and
    the gzip stream reached its end-of-stream marker. `source_bytes` is the compressed size read."""

    def __init__(self, chunks: Iterable[bytes], expected_length: "int | None") -> None:
        self.chunks, self.expected_length, self.source_bytes = chunks, expected_length, 0

    def __iter__(self) -> Iterator[str]:
        inflater = zlib.decompressobj(wbits=zlib.MAX_WBITS | 16)  # gzip framing
        pending = b""
        finished = False  # the current gzip member ended
        for chunk in self.chunks:
            self.source_bytes += len(chunk)
            data = chunk
            while data:
                if finished:  # a further member (or padding after the last one)
                    inflater, finished = zlib.decompressobj(wbits=zlib.MAX_WBITS | 16), False
                try:
                    pending += inflater.decompress(data)
                except zlib.error as exc:
                    raise IncompleteDownload(f"corrupt gzip stream: {exc}") from exc
                finished = inflater.eof
                data = inflater.unused_data if finished else b""
            *lines, pending = pending.split(b"\n")
            for line in lines:
                yield line.decode("utf-8", "replace")
        if self.expected_length is not None and self.source_bytes != self.expected_length:
            raise IncompleteDownload(f"received {self.source_bytes} of {self.expected_length} bytes")
        if not finished:
            raise IncompleteDownload("the gzip stream ended before its end-of-stream marker")
        if pending:
            yield pending.decode("utf-8", "replace")


def _fetch_lines(lang: str) -> GzipLines:
    """Stream kaikki's gzipped JSONL for `lang` as verified lines."""
    name = build_dict.lang_names(lang)[0]
    url = URL.format(name=urllib.parse.quote(name))
    try:
        resp = urllib.request.urlopen(url, timeout=60)
    except urllib.error.HTTPError as exc:
        raise Unavailable(f"{url}: HTTP {exc.code}") from exc
    length = resp.headers.get("Content-Length")

    def chunks() -> Iterator[bytes]:
        with resp:
            while True:
                block = resp.read(1 << 16)  # b"" is also what a dropped connection looks like
                if not block:
                    return
                yield block

    return GzipLines(chunks(), int(length) if length is not None else None)


_complete_cache: dict[str, tuple[tuple[int, int], bool]] = {}


def is_complete(path: Path) -> bool:
    """Does this DB carry meta(complete=1)? (Cached per file version.)"""
    try:
        st = path.stat()
    except OSError:
        return False
    version = (st.st_mtime_ns, st.st_size)
    cached = _complete_cache.get(str(path))
    if cached and cached[0] == version:
        return cached[1]
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = conn.execute("SELECT value FROM meta WHERE key = 'complete'").fetchone()
        finally:
            conn.close()
        ok = bool(row and row[0] == "1")
    except sqlite3.Error:
        ok = False
    _complete_cache[str(path)] = (version, ok)
    return ok


def lock_path(lang: str) -> Path:
    return DATA_DIR / f".{lang}-en.lock"


def _job(lang: str, fd: "int | None" = None) -> None:
    try:
        # We hold the language's lock, so no other process is building: leftovers of crashed builds are garbage.
        for stale in dict_path(lang).parent.glob(f"{lang}-en.*.building"):
            stale.unlink(missing_ok=True)
        build_dict.build(_fetch_lines(lang), lang, dict_path(lang))
        log.info("dictionary ready: %s", dict_path(lang).name)
    except Exception as exc:  # noqa: BLE001 - 404, network drop, empty stream: retried after COOLDOWN
        log.warning("dictionary download for %s failed: %s", lang, exc)
        with _lock:
            _failed[lang] = _now()
    finally:
        with _lock:
            _running.discard(lang)
        if fd is not None:
            unlock(fd)


def ensure(lang: str) -> str:
    """"ready" | "downloading" | "unavailable". Idempotent: one download per language at a time.

    An existing file without the completeness marker is rebuilt (keeping it readable meanwhile)."""
    if lang not in hymt.languages():
        return "unavailable"
    path = dict_path(lang)
    if path.exists() and (lang in NO_AUTO_DOWNLOAD or is_complete(path)):
        return "ready"
    if lang in NO_AUTO_DOWNLOAD:
        return "unavailable"
    with _lock:
        if lang in _running:
            return "downloading"
        if path.exists() and is_complete(path):
            return "ready"
        if lang in _failed and _now() - _failed[lang] < COOLDOWN:
            return "ready" if path.exists() else "unavailable"  # a legacy file keeps serving
        # Another process (a second server on the same data folder) may already be building it.
        fd = try_lock(lock_path(lang))
        if fd is None:
            return "downloading"
        _failed.pop(lang, None)
        _running.add(lang)
    try:
        threading.Thread(target=_job, args=(lang, fd), daemon=True, name=f"dict-{lang}").start()
    except BaseException:  # the job never ran, so it will never release these
        with _lock:
            _running.discard(lang)
        unlock(fd)
        raise
    return "downloading"


def resolve_lemma(conn: sqlite3.Connection, word: str) -> list[str]:
    """`word` followed by the lemmas its form-of / alt-of entries point to (followed two levels deep)."""
    out = [word]
    frontier = [word]
    for _ in range(2):
        nxt = []
        for w in frontier:
            rows = conn.execute(
                "SELECT word, form_of FROM entries WHERE key = ? AND form_of != '' ORDER BY rank",
                (build_dict.norm_key(w),),
            ).fetchall()
            # A vocalised word (a Stanza lemma) means its own spelling, not every word that shares its bare key.
            rows = [r for r in rows if r[0] == w] or rows
            rows = list(dict.fromkeys(r[1] for r in rows))
            for target in rows:
                if target not in out:
                    out.append(target)
                    nxt.append(target)
        frontier = nxt
    return out


def lookup_keys(conn: sqlite3.Connection, keys: Iterable[str]) -> dict[str, dict]:
    """The best entry for each of `keys` that the dictionary has, in one query: {key: {word, glosses}}.

    "Best" is a real entry before a form-of one, then the lowest rank. A form-of entry (an inflected
    spelling, "mis en cause") comes back as the entry it points at ("mettre en cause", with that entry's
    glosses), plus `via`: the inflected spelling. Callers pass a few dozen keys at most (SQLite allows
    999 variables per statement)."""
    out = _best_entries(conn, keys)
    for _ in range(2):  # an alt-of entry may point at a form-of one: follow two levels, as resolve_lemma does
        pointing = {k: e for k, e in out.items() if e["form_of"]}
        if not pointing:
            break
        targets = _best_entries(conn, (build_dict.norm_key(e["form_of"]) for e in pointing.values()))
        for k, e in pointing.items():
            target = targets.get(build_dict.norm_key(e["form_of"]))
            word = target["word"] if target else e["form_of"]
            glosses = target["glosses"] if target else e["glosses"]
            out[k] = {"word": word, "glosses": glosses, "form_of": target["form_of"] if target else "", "via": e.get("via", e["word"])}
    for e in out.values():
        del e["form_of"]
    return out


def _best_entries(conn: sqlite3.Connection, keys: Iterable[str]) -> dict[str, dict]:
    """{key: {word, glosses, form_of}} for the best row of each key (real entries first, then rank)."""
    keys = list(dict.fromkeys(keys))
    if not keys:
        return {}
    marks = ",".join("?" * len(keys))
    rows = conn.execute(
        f"SELECT key, word, glosses, form_of FROM entries WHERE key IN ({marks}) ORDER BY form_of != '', rank", keys
    ).fetchall()
    out: dict[str, dict] = {}
    for key, word, glosses, form_of in rows:
        out.setdefault(key, {"word": word, "glosses": json.loads(glosses), "form_of": form_of or ""})
    return out
