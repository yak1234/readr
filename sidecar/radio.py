"""World radio search through Radio Browser (https://www.radio-browser.info), via pyradios."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from unittest import mock
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pyradios import RadioBrowser, base_url, radios

_TABLE = json.loads((Path(__file__).resolve().parent.parent / "shared" / "languages.json").read_text("utf-8"))

# Radio Browser language name ("arabic") by ISO code, and every spelling we accept back to an ISO code.
_RB_NAME = {code: row["radioBrowser"] for code, row in _TABLE.items() if row.get("radioBrowser")}
_ALIASES: dict[str, str] = {}
for _code, _row in _TABLE.items():
    for _alias in [_code, _row["name"], _row["native"], _row.get("radioBrowser"), *_row.get("aliases", [])]:
        if _alias:
            _ALIASES[_alias.lower()] = _code

TIMEOUT = 10.0
UNREACHABLE = "Radio Browser is unreachable."

router = APIRouter(prefix="/radio")
_browser = None
_lock = threading.Lock()


def normalise_language_tags(tags: str) -> list[str]:
    """Twin of normaliseLanguageTags in shared/languages.ts."""
    codes: list[str] = []
    for tag in tags.split(","):
        code = _ALIASES.get(tag.strip().lower())
        if code and code not in codes:
            codes.append(code)
    return codes


def set_browser(browser) -> None:
    """Inject a client (tests); None goes back to a real one."""
    global _browser
    _browser = browser


def _client():
    global _browser
    with _lock:
        if _browser is None:
            # A timeout so a dead or hung server cannot tie up the threadpool.
            session = httpx.Client(timeout=TIMEOUT)
            override = os.environ.get("READR_RADIO_BROWSER")
            try:
                if override:
                    # pyradios has no base-URL argument: it discovers a server in its constructor. Swap that step
                    # for the override while constructing, then restore it. patch.object raises if it is renamed.
                    with mock.patch.object(radios, "pick_base_url", lambda: override.rstrip("/") + "/"):
                        _browser = RadioBrowser(session=session)
                else:
                    _browser = RadioBrowser(session=session)
            except BaseException as exc:
                session.close()
                # Discovery found no usable host (pyradios raises IndexError on an empty list, or its own Error).
                if isinstance(exc, (IndexError, base_url.Error)):
                    raise HTTPException(503, UNREACHABLE) from exc
                raise
        return _browser


# Only these mean "Radio Browser can't be reached"; anything else is a bug and should surface as a 500.
_NETWORK_ERRORS = (httpx.HTTPError, OSError, json.JSONDecodeError)


def _call(fn: str, *args, **kwargs):
    try:
        return getattr(_client(), fn)(*args, **kwargs)
    except _NETWORK_ERRORS as exc:
        raise HTTPException(503, UNREACHABLE) from exc


def _station(raw: dict) -> dict:
    return {
        "id": raw.get("stationuuid", ""),
        "name": (raw.get("name") or "").strip(),
        "url": raw.get("url_resolved") or raw.get("url") or "",
        "homepage": raw.get("homepage") or "",
        "favicon": raw.get("favicon") or "",
        "country": raw.get("country") or "",
        "countrycode": raw.get("countrycode") or "",
        "languages": normalise_language_tags(raw.get("language") or ""),
        "tags": [t.strip() for t in (raw.get("tags") or "").split(",") if t.strip()],
        "codec": raw.get("codec") or "",
        "bitrate": raw.get("bitrate") or 0,
        "hls": bool(raw.get("hls")),
    }


@router.get("/search")
def search(country: str = "", language: str = "", name: str = "", tag: str = "", limit: int = 50) -> list[dict]:
    params: dict = {"order": "clickcount", "reverse": True, "hidebroken": True, "limit": max(1, min(limit, 500))}
    if country:
        params["countrycode"] = country
    if language:
        params["language"] = _RB_NAME.get(language, language.lower())
        params["language_exact"] = True  # otherwise "malay" matches Malayalam
    if name:
        params["name"] = name
    if tag:
        params["tag"] = tag
    return [_station(s) for s in _call("search", **params)]


@router.get("/countries")
def countries() -> list[dict]:
    return [
        {"code": c["iso_3166_1"], "name": c["name"], "count": c.get("stationcount", 0)}
        for c in _call("countries")
        if c.get("iso_3166_1") and c.get("name")
    ]


@router.get("/languages")
def languages() -> list[dict]:
    counts: dict[str, int] = {}
    for entry in _call("languages"):
        code: Optional[str] = (normalise_language_tags(entry.get("name") or "") or [None])[0]
        if code:
            counts[code] = counts.get(code, 0) + entry.get("stationcount", 0)
    return [{"code": c, "name": _TABLE[c]["name"], "count": n} for c, n in counts.items()]
