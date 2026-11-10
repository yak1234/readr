"""Readr sidecar: local translation and word lookup.

Endpoints (127.0.0.1 only):
  GET  /health     -> which engines are loaded
  POST /translate  -> {"sentences": [...], "src", "tgt", "context"?} -> {"translations": [...]}
  POST /lookup     -> {"word", "sentence", "lang", "tgt", "offset"?} -> lemma, grammar, parts, dictionary senses, gloss_target
  POST /dictionaries/ensure -> {"lang"} -> {"lang", "status", "analysis"}, each "ready" | "downloading" | "unavailable"
  POST /analysis/warm       -> {"lang"} -> loads that language's Stanza pipeline in the background

Word analysis (lemma, word type, clitic parts) is Stanza's, per language; see analysis.py.
Translation runs Tencent Hy-MT2-1.8B (8-bit MLX build; READR_TRANSLATOR_MODEL overrides) through mlx-lm; see hymt.py.

Models load in a background thread so /health answers immediately.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import analysis
import build_dict
import dictionaries
import hymt
import lifeline
import phrases
import radio
import runtime

HERE = Path(__file__).resolve().parent
MAX_CONTEXT = 3

log = logging.getLogger("readr")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # model downloads log every request at INFO


# --------------------------------------------------------------------------- engines


class Engines:
    def __init__(self) -> None:
        self.ready = threading.Event()
        self.translator = None  # hymt.HyMt (or a test stub)
        self.translator_name = ""
        self.dictionaries: dict[str, Dictionary] = {}  # opened lazily, by language
        self.errors: list[str] = []

    # -- translation -----------------------------------------------------------
    def _load_translator(self) -> None:
        try:
            from hymt import HyMt

            self.translator = HyMt()
            self.translator_name = self.translator.model_id
            log.info("translator ready: %s", self.translator_name)
        except Exception as exc:  # noqa: BLE001 - reported through /health
            msg = f"{hymt.MODEL_ID}: {exc.__class__.__name__}: {exc}"
            log.warning("translator unavailable (%s)", msg)
            self.errors.append(msg)

    def dictionary_for(self, lang: str) -> "Optional[Dictionary]":
        """The opened dictionary for `lang`, or None until its file exists."""
        d = self.dictionaries.get(lang)
        if d is None and lang in hymt.languages() and dictionaries.dict_path(lang).exists():
            d = self.dictionaries[lang] = Dictionary(dictionaries.dict_path(lang))
        return d

    def load_all(self) -> None:
        self._load_translator()
        self.ready.set()

    def translate(self, items: list[tuple[str, list[str]]], src: str, tgt: str) -> list[str]:
        if not self.ready.wait(timeout=600):
            raise HTTPException(503, "Models are still loading.")
        if self.translator is None:
            raise HTTPException(503, "No translation engine could be loaded: " + "; ".join(self.errors))
        return self.translator.translate(items, src, tgt)  # HyMt serializes its own calls


# --------------------------------------------------------------------------- dictionary


class Dictionary:
    """Read-only access to the SQLite file produced by build_dict.py."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        # A rebuild replaces the file (a new inode); reopen so lookups see the new dictionary.
        stamp = os.stat(self.path).st_ino
        conn = getattr(self.local, "conn", None)
        if conn is not None and getattr(self.local, "stamp", None) != stamp:
            conn.close()
            conn = None
        if conn is None:
            conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
            self.local.conn, self.local.stamp = conn, stamp
        return conn

    def lemmas(self, word: str) -> list[str]:
        return dictionaries.resolve_lemma(self._conn(), word)

    def by_keys(self, keys: list[str]) -> dict[str, dict]:
        return dictionaries.lookup_keys(self._conn(), keys)

    def entries(self, word: str) -> list[dict]:
        rows = self._conn().execute(
            "SELECT word, pos, glosses, tags, ipa, form_of FROM entries WHERE key = ? ORDER BY rank",
            (build_dict.norm_key(word),),
        ).fetchall()
        return [
            {
                "word": r[0],
                "pos": r[1],
                "glosses": json.loads(r[2]),
                "tags": json.loads(r[3]),
                "ipa": r[4] or "",
                "form_of": r[5] or "",
            }
            for r in rows
        ]


UPOS_TO_WIKT = {
    "NOUN": "noun", "PROPN": "name", "VERB": "verb", "AUX": "verb", "ADJ": "adj", "ADV": "adv",
    "PRON": "pron", "DET": "det", "ADP": "prep", "CCONJ": "conj", "SCONJ": "conj", "NUM": "num", "INTJ": "intj",
}


def substantive(entries: list[dict]) -> list[dict]:
    """Entries that say what a word means. A form-of entry ("plural of X") doesn't, unless it also has
    glosses of its own (Arabic verbal nouns carry both): those are kept, minus the "... of X" gloss."""
    out = []
    for e in entries:
        if not e["glosses"]:
            continue
        if e["form_of"]:
            target = build_dict.norm_key(e["form_of"])
            glosses = [g for g in e["glosses"] if target not in build_dict.norm_key(g)]
            if glosses:
                out.append({**e, "glosses": glosses})
        else:
            out.append(e)
    return out


def senses_for(dictionary: Dictionary, word: str, lemma: str, pos: str) -> tuple[list[dict], str]:
    """Dictionary senses and an IPA string: the (normalised) Stanza lemma first, then the surface word,
    then Wiktionary's own form-of links. Keys are normalised by build_dict.norm_key on both sides."""
    surface = dictionary.entries(word)
    lemma_entries = dictionary.entries(lemma) if lemma and build_dict.norm_key(lemma) != build_dict.norm_key(word) else []
    pool = substantive(lemma_entries + surface)
    if not pool:  # the analysis found no meaning: follow Wiktionary's own "form of" links
        for w in (lemma, word):
            for target in dictionary.lemmas(w)[1:] if w else []:
                lemma_entries += dictionary.entries(target)
        pool = substantive(lemma_entries + surface) or [e for e in surface if e["glosses"]]
    # Prefer the exact spelling asked for ("Paris" over "paris"; a vocalised Arabic lemma over its bare look-alikes).
    pool = [e for e in pool if e["word"] in (word, lemma)] or pool
    wanted = UPOS_TO_WIKT.get(pos)
    pool.sort(key=lambda e: 0 if wanted and e["pos"] == wanted else 1)

    senses, seen = [], set()
    for e in pool:
        glosses = [g for g in e["glosses"] if g not in seen]
        seen.update(glosses)
        if glosses:
            senses.append({"pos": e["pos"], "glosses": glosses[:5], "tags": e["tags"][:3]})
    ipa = next((e["ipa"] for e in surface if e["ipa"]), "") or next((e["ipa"] for e in lemma_entries if e["ipa"]), "")
    return senses[:4], ipa


# --------------------------------------------------------------------------- API


engines = Engines()
app = FastAPI(title="Readr sidecar")
app.include_router(radio.router)
_cache: "OrderedDict[tuple[str, str, str], str]" = OrderedDict()
_CACHE_MAX = 20_000


class TranslateIn(BaseModel):
    sentences: list[str]
    src: str = "fr"
    tgt: str = "en"
    context: Optional[list[list[str]]] = None
    cache: bool = True  # False: translate in this context every time and keep nothing (a selected word)


class LookupIn(BaseModel):
    word: str
    sentence: str = ""
    lang: str = "fr"
    tgt: str = "en"
    offset: Optional[int] = None  # the clicked word's character offset in `sentence`, where known


class EnsureIn(BaseModel):
    lang: str


@app.get("/health")
def health() -> dict:
    loading = not engines.ready.is_set()
    ok = engines.translator is not None
    if loading:
        message = "Loading models (the first run downloads ~1 GB)…"
    elif not ok:
        message = "No translation engine: " + "; ".join(engines.errors)
    else:
        message = "Ready"
    return {
        "app": "readr",
        "ok": ok,
        "translator": engines.translator_name,
        "stanza": analysis.available(),
        "torchThreads": analysis.live_torch_threads(),
        "dictionary": bool(engines.dictionaries) or dictionaries.dict_path("fr").exists(),
        "message": message,
    }


def translate_uncached(sentences: list[str], src: str, tgt: str, context: Optional[list[list[str]]] = None) -> list[str]:
    """Translate each sentence in its own context, keeping nothing: for text whose meaning depends on it."""
    if src == tgt:
        return list(sentences)
    items = [(s, list((context[i] if context and i < len(context) else [])[-MAX_CONTEXT:])) for i, s in enumerate(sentences)]
    todo = [it for it in items if it[0].strip()]
    done = iter(engines.translate(todo, src, tgt) if todo else [])
    return [next(done) if s.strip() else "" for s, _ in items]


def translate_cached(
    sentences: list[str], src: str = "fr", tgt: str = "en", context: Optional[list[list[str]]] = None
) -> list[str]:
    """Translate, caching by (sentence, src, tgt); context only informs a miss."""
    if src == tgt:  # nothing to translate: don't hold the model's lock for it
        return list(sentences)
    todo: dict[str, list[str]] = {}
    for i, s in enumerate(sentences):
        if s.strip() and (s, src, tgt) not in _cache and s not in todo:
            ctx = context[i] if context and i < len(context) else []
            todo[s] = list(ctx[-MAX_CONTEXT:])
    if todo:
        for s, t in zip(todo, engines.translate(list(todo.items()), src, tgt)):
            _cache[(s, src, tgt)] = t
            if len(_cache) > _CACHE_MAX:
                _cache.popitem(last=False)
    return [_cache.get((s, src, tgt), "") for s in sentences]


@app.post("/translate")
def translate(body: TranslateIn) -> dict:
    for code in (body.src, body.tgt):
        if not hymt.is_supported(code):
            raise HTTPException(400, f"No translation for {code}.")
    run = translate_cached if body.cache else translate_uncached
    return {"translations": run(body.sentences, body.src, body.tgt, body.context)}


_PUNCT = "'’.,;:!?\"«»()[]¿¡،؛؟"


def find_token(tokens: list[dict], word: str, offset: Optional[int]) -> Optional[dict]:
    """The sentence token the user clicked: the one at `offset`, else the first whose text is `word`."""
    plain = word.strip(_PUNCT)
    if offset is not None:
        at = next((t for t in tokens if t["start"] <= offset < t["end"]), None)
        if at is not None and (plain in at["text"] or at["text"].strip(_PUNCT) in word):
            return at
    return next((t for t in tokens if t["text"] == word or t["text"].strip(_PUNCT) == plain), None)


_analysis_failed: dict[str, float] = {}  # language -> when Stanza last failed there
ANALYSIS_COOLDOWN = 600.0  # seconds a failing language is left alone


def analysis_broken(lang: str) -> bool:
    failed = _analysis_failed.get(lang)
    return failed is not None and time.monotonic() - failed < ANALYSIS_COOLDOWN


def guarded(lang: str, run, default):
    """run() unless Stanza is cooling down in `lang`; a failure is logged and starts the cooldown, and
    `default` answers instead, so the dictionary and the glosses still do."""
    if analysis_broken(lang):
        return default
    try:
        return run()
    except Exception as exc:  # noqa: BLE001 - analysis is optional
        log.warning("analysis of %s failed, skipping it for %ds: %s", lang, ANALYSIS_COOLDOWN, exc)
        _analysis_failed[lang] = time.monotonic()
        return default


def analyse(word: str, sentence: str, lang: str, offset: Optional[int] = None) -> tuple[Optional[dict], list[dict]]:
    """(chosen part, all parts) of the clicked word, or (None, []) when there is no analysis."""
    return guarded(lang, lambda: _analyse(word, sentence, lang, offset), (None, []))


def _analyse(word: str, sentence: str, lang: str, offset: Optional[int] = None) -> tuple[Optional[dict], list[dict]]:
    tokens = analysis.analyse(sentence or word, lang)
    token = find_token(tokens, word, offset)
    if token is None and sentence and sentence != word:  # not in the sentence: analyse the word alone
        token = find_token(analysis.analyse(word, lang), word, None)
    if token is None:
        return None, []
    return analysis.pick_part(token), token["parts"]


def feats_dict(feats: Optional[str]) -> dict:
    return dict(f.split("=", 1) for f in feats.split("|") if "=" in f) if feats else {}


@app.post("/dictionaries/ensure")
def ensure_dictionary(body: EnsureIn) -> dict:
    # Saving a source or station in a language asks for its dictionary and its analysis models together.
    return {"lang": body.lang, "status": dictionaries.ensure(body.lang), "analysis": analysis.ensure_analysis(body.lang)}


@app.post("/analysis/warm")
def warm_analysis(body: EnsureIn) -> dict:
    """Load the language's models into memory ahead of the first word click (never downloads)."""
    ready = analysis.model_ready(body.lang) if body.lang in hymt.languages() else False
    if ready:
        analysis.warm(body.lang)
    return {"lang": body.lang, "analysis": "ready" if ready else "unavailable"}


def mt(word: str, src: str, tgt: str, sentence: str = "") -> str:
    """Hy-MT2's translation of a word (in its sentence, as context); empty when unavailable."""
    if src == tgt:
        return word
    if engines.translator is None:
        return ""
    try:
        return translate_cached([word], src, tgt, [[sentence]] if sentence else None)[0]
    except Exception:  # noqa: BLE001 - glosses are optional
        return ""


class PhraseIn(BaseModel):
    lang: str
    sentence: str
    start: int  # the selection, as character offsets into `sentence`
    end: int


@app.post("/phrase")
def phrase(body: PhraseIn) -> dict:
    """Snap a selection to the longest dictionary phrase containing it; the selection itself otherwise.
    `ready` is False when neither the dictionary nor the word analysis is there for the language yet (a
    first run still downloading): the form is then only the text as selected, not a dictionary form."""
    sentence, start, end = body.sentence, body.start, body.end
    if not 0 <= start < end <= len(sentence):
        raise HTTPException(400, "The selection is outside the sentence.")
    analysed = guarded(body.lang, lambda: analysis.analyse(sentence, body.lang), []) if analysis.model_ready(body.lang) else []
    tokens = phrases.tokens_from_analysis(sentence, analysed) if analysed else phrases.surface_tokens(sentence)
    first, last = phrases.selected(tokens, start, end)
    dictionary = engines.dictionary_for(body.lang)
    ready = dictionary is not None or bool(analysed)
    hit = None
    if first < last and dictionary is not None:
        hit = phrases.snap(sentence, tokens, first, last, dictionary.by_keys, build_dict.norm_key)
    if hit is not None and hit.end - hit.first > 1:
        return {
            "start": tokens[hit.first].start,
            "end": tokens[hit.end - 1].end,
            "form": hit.entry["word"],
            "definition": _first_gloss(hit.entry),
            "snapped": True,
            "ready": True,
        }
    # A single word keeps its analysed lemma, unless the dictionary only knew it as an inflected spelling.
    # The selection as it is, widened to the whole of the words it touches (a drag rarely lands on word edges).
    if first < last:
        start, end = tokens[first].start, tokens[last - 1].end
    form = hit.entry["word"] if hit and "via" in hit.entry else tokens[first].lemma if last - first == 1 else sentence[start:end]
    return {"start": start, "end": end, "form": form, "definition": _first_gloss(hit.entry) if hit else "", "snapped": False, "ready": ready}


def _first_gloss(entry: dict) -> str:
    return entry["glosses"][0] if entry["glosses"] else ""


@app.post("/lookup")
def lookup(body: LookupIn) -> dict:
    word = body.word.strip()
    if not word:
        raise HTTPException(400, "Empty word.")
    lang, tgt = body.lang, body.tgt
    engines.ready.wait(timeout=120)
    analysis_status = analysis.ensure_analysis(lang)
    part, parts = analyse(word, body.sentence, lang, body.offset) if analysis_status == "ready" else (None, [])
    if analysis_status == "ready" and analysis_broken(lang):
        analysis_status = "unavailable"
    lemma = (part or {}).get("lemma") or word
    pos = (part or {}).get("upos", "")
    morph = feats_dict((part or {}).get("feats"))

    dictionary = engines.dictionary_for(lang)
    status = dictionaries.ensure(lang) if dictionary is None else "ready"
    if status == "ready" and dictionary is None:  # finished downloading a moment ago
        dictionary = engines.dictionary_for(lang)
    if dictionary is not None:
        dictionaries.ensure(lang)  # a legacy (unmarked) file keeps serving while it is rebuilt
    senses, ipa = ([], "")
    if dictionary is not None:
        senses, ipa = senses_for(dictionary, word, lemma if part else "", pos)
        if part is None:
            lemma = dictionary.lemmas(word)[-1]

    # Verbs read better from the infinitive; everything else as written.
    mt_gloss = mt(lemma if pos in ("VERB", "AUX") and lemma else word, lang, "en")
    gloss_target = mt(word, lang, tgt, body.sentence) if tgt != "en" else ""

    return {
        "word": word,
        "lemma": lemma,
        "pos": pos,
        "morph": morph,
        "parts": parts,
        "analysis": analysis_status,
        "ipa": ipa,
        "senses": senses,
        "mtGloss": mt_gloss,
        "gloss_target": gloss_target,
        "dictionary": status if dictionary is None else "ready",
        "dictionaryAvailable": dictionary is not None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    lifeline.watch()
    # The dictionaries that ship with the app, put where they can be rebuilt and added to.
    copied = runtime.seed_dictionaries(dictionaries.DATA_DIR)
    if copied:
        log.info("dictionaries copied from the app: %s", ", ".join(copied))
    threading.Thread(target=engines.load_all, daemon=True).start()
    analysis.predownload_core()  # disk only; pipelines load lazily

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
