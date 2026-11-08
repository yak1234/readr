"""Build the offline French→English dictionary used by the sidecar.

Input: a Wiktextract JSONL file from kaikki.org (English Wiktionary data, so
the glosses are in English). Either of these works:

  * the French-only file (≈565 MB, marked deprecated by kaikki but still served):
      https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl
  * the full raw dump (≈2.9 GB gzipped; only French entries are kept):
      https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz

Usage:
  python build_dict.py path/to/file.jsonl[.gz]  [--out data/fr-en.sqlite]

The input is streamed line by line, so memory use stays small.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


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
        if not form_of and sense.get("form_of"):
            form_of = sense["form_of"][0].get("word", "")
    # Pure inflection entries ("plural of X") keep the link and a short gloss.
    if not glosses and not form_of:
        return
    yield word, pos, glosses, tags, ipa, form_of


def build(src: Path, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".building")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.execute("PRAGMA journal_mode = OFF")
    db.execute("PRAGMA synchronous = OFF")
    db.execute(
        """CREATE TABLE entries (
             key TEXT NOT NULL, word TEXT NOT NULL, pos TEXT, glosses TEXT, tags TEXT,
             ipa TEXT, form_of TEXT, rank INTEGER)"""
    )

    kept = seen = 0
    batch = []
    with open_any(src) as fh:
        for line in fh:
            seen += 1
            # Cheap pre-filter before JSON parsing: the raw dump has every language.
            if '"lang_code": "fr"' not in line and '"lang": "French"' not in line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("lang_code") not in (None, "fr") and obj.get("lang") != "French":
                continue
            for word, pos, glosses, tags, ipa, form_of in entry_rows(obj):
                batch.append((word.lower(), word, pos, json.dumps(glosses, ensure_ascii=False), json.dumps(tags), ipa, form_of, kept))
                kept += 1
            if len(batch) >= 5000:
                db.executemany("INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)", batch)
                batch.clear()
                print(f"\r{seen:,} lines read, {kept:,} French entries kept", end="", file=sys.stderr)
    if batch:
        db.executemany("INSERT INTO entries VALUES (?,?,?,?,?,?,?,?)", batch)
    print(f"\r{seen:,} lines read, {kept:,} French entries kept", file=sys.stderr)

    db.execute("CREATE INDEX idx_key ON entries(key)")
    db.commit()
    db.execute("VACUUM")
    db.close()
    tmp.replace(out)
    print(f"Wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, default=HERE / "data" / "fr-en.sqlite")
    args = parser.parse_args()
    build(args.source, args.out)
