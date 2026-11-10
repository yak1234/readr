"""Build an offline <language>→English dictionary used by the sidecar.

Input: a Wiktextract JSONL file from kaikki.org (English Wiktionary data, so
the glosses are in English). Per-language files are served gzipped at

  https://kaikki.org/dictionary/<Language>/kaikki.org-dictionary-<Language>.jsonl.gz

(dictionaries.py downloads it and streams it straight into build()). Besides headwords and
form-of senses, each lemma's inflection table (Wiktextract "forms") is indexed so inflected
spellings find their lemma. The full raw dump also works; only the
requested language's entries are kept:
  https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz

Usage:
  python build_dict.py LANG path/to/file.jsonl[.gz]  [--out data/LANG-en.sqlite]

The input is streamed line by line, so memory use stays small.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Iterable

import arabic
import hymt

HERE = Path(__file__).resolve().parent

# Hebrew niqqud appear in running text only sometimes (Arabic marks are handled by arabic.normalise).
_MARKS = re.compile("[\u0591-\u05c7]")
# Wiktextract "forms" rows that describe the table, not a word.
_TABLE_TAGS = {"table-tags", "inflection-template", "class", "romanization", "transliteration", "canonical"}


def norm_key(word: str) -> str:
    """Lookup key: lowercase, NFC, without optional vowel marks, Arabic alef forms unified."""
    return arabic.normalise(_MARKS.sub("", word.lower()))


def lang_names(lang: str) -> tuple[str, str]:
    """(English name, wiktextract lang_code) for a Readr language code; zh-Hant is Wiktionary's Chinese."""
    info = hymt.languages().get(lang)
    if info is None:
        raise ValueError(f"unknown language {lang!r}")
    return info["name"], lang.split("-")[0]


def open_any(path: Path):
    return gzip.open(path, "rt", encoding="utf-8") if path.suffix == ".gz" else path.open(encoding="utf-8")


def entry_rows(obj: dict):
    """Yield (word, pos, glosses, tags, ipa, form_of) rows for one Wiktextract entry."""
    word = obj.get("word")
    if not word:
        return
    pos = obj.get("pos", "")
    ipa = next((s["ipa"] for s in obj.get("sounds", []) if s.get("ipa")), "")
    glosses, tags, form_of = [], [], ""
    for sense in obj.get("senses", []):
        g = sense.get("glosses") or sense.get("raw_glosses") or []
        if g:
            glosses.append(g[-1])  # the last gloss is the most specific one
        for t in sense.get("tags", []):
            if t in ("masculine", "feminine", "plural", "singular", "informal", "formal", "figuratively", "slang", "dated", "Quebec", "Belgium", "Switzerland") and t not in tags:
                tags.append(t)
        if not form_of:
            # Inflections ("form_of") and spelling variants ("alt_of") both point at the lemma.
            for key in ("form_of", "alt_of"):
                if sense.get(key):
                    form_of = sense[key][0].get("word", "")
                    break
    # Pure inflection entries ("plural of X") keep the link and a short gloss.
    if not glosses and not form_of:
        return
    yield word, pos, glosses, tags, ipa, form_of
    # Wiktextract's inflection table: every inflected spelling points back at this lemma, so clicking
    # an inflected form (Arabic broken plurals, verb forms) finds the entry.
    if glosses and not form_of:
        seen = {norm_key(word)}
        for f in obj.get("forms", []):
            form = f.get("form") or ""
            ftags = set(f.get("tags", []))
            key = norm_key(form)
            if not form or ftags & _TABLE_TAGS or form.startswith("no-") or not any(c.isalnum() for c in form) or key in seen:
                continue
            seen.add(key)
            yield form, pos, [], [t for t in f.get("tags", []) if t in ("masculine", "feminine", "plural", "singular")], "", word


def build(src: "Path | Iterable[str]", lang: str, out: Path) -> None:
    """Write `out` (SQLite) from kaikki JSONL: a path (.jsonl or .gz) or any iterable of lines.

    The file is built as <out>.building and renamed only when the input ended cleanly (an iterable
    that raises, e.g. a cut-off download, publishes nothing). The finished DB carries
    meta(complete=1, source_bytes, entries); a DB without it is treated as unfinished by dictionaries.ensure.
    An existing `out` stays readable until the rename."""
    name, code = lang_names(lang)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(f".{os.getpid()}.building")  # unique per process: never another builder's file
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.execute("PRAGMA journal_mode = OFF")
    db.execute("PRAGMA synchronous = OFF")
    db.execute(
        """CREATE TABLE entries (
             key TEXT NOT NULL, word TEXT NOT NULL, pos TEXT, glosses TEXT, tags TEXT,
             ipa TEXT, form_of TEXT, rank INTEGER)"""
    )
    marker_code, marker_name = f'"lang_code": "{code}"', f'"lang": "{name}"'
    kept = seen = 0
    batch = []

    def flush():
        db.executemany("INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)", batch)
        batch.clear()

    try:
        fh = open_any(src) if isinstance(src, Path) else None
        for line in fh if fh is not None else src:
            seen += 1
            # Cheap pre-filter before JSON parsing: the raw dump has every language.
            if marker_code not in line and marker_name not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("lang_code") not in (None, code) and obj.get("lang") != name:
                continue
            for word, pos, glosses, tags, ipa, form_of in entry_rows(obj):
                batch.append((norm_key(word), word, pos, json.dumps(glosses, ensure_ascii=False), json.dumps(tags), ipa, form_of, kept))
                kept += 1
            if len(batch) >= 5000:
                flush()
                print(f"\r{seen:,} lines read, {kept:,} {name} entries kept", end="", file=sys.stderr)
        if fh is not None:
            fh.close()
        flush()
        print(f"\r{seen:,} lines read, {kept:,} {name} entries kept", file=sys.stderr)
        if kept == 0:  # empty or truncated input must never become a "ready" dictionary
            raise ValueError(f"no {name} entries in the input")
        db.execute("CREATE INDEX idx_key ON entries(key)")
        source_bytes = src.stat().st_size if isinstance(src, Path) else getattr(src, "source_bytes", 0)
        db.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        db.executemany(
            "INSERT INTO meta VALUES (?, ?)",
            [("complete", "1"), ("source_bytes", str(source_bytes)), ("entries", str(kept))],
        )
        db.commit()
        db.execute("VACUUM")
        db.close()
    except BaseException:
        db.close()
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(out)
    print(f"Wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("lang")
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    build(args.source, args.lang, args.out or HERE / "data" / f"{args.lang}-en.sqlite")
