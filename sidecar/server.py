"""Readr sidecar: local French→English translation and word lookup.

Endpoints (127.0.0.1 only):
  GET  /health     -> which engines are loaded
  POST /translate  -> {"sentences": [...]} -> {"translations": [...]}
  POST /lookup     -> {"word": "...", "sentence": "..."} -> lemma, grammar, dictionary senses

Translation engine, in order of preference:
  1. quickmt-fr-en  (200M params, run with CTranslate2 + SentencePiece)
  2. Helsinki-NLP/opus-mt-fr-en via transformers (fallback; needs torch)
Set READR_TRANSLATOR=quickmt|opus to force one.

Models load in a background thread so /health answers immediately.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
DICT_PATH = Path(os.environ.get("READR_DICT", HERE / "data" / "fr-en.sqlite"))
MODEL_DIR = Path(os.environ.get("READR_MODEL_DIR", HERE / "models"))

log = logging.getLogger("readr")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


# --------------------------------------------------------------------------- engines


class Engines:
    def __init__(self) -> None:
        self.ready = threading.Event()
        self.translate_fn: Optional[Callable[[list[str]], list[str]]] = None
        self.translator_name = ""
        self.nlp = None
        self.dictionary: Optional[Dictionary] = None
        self.errors: list[str] = []
        self.lock = threading.Lock()  # CTranslate2 / torch calls are serialized

    # -- translation -----------------------------------------------------------
    def _load_quickmt(self) -> None:
        # The model is used through CTranslate2 directly rather than the quickmt
        # package: that package's sentence splitter (blingfire) ships no Apple Silicon
        # build, and the app already sends one sentence per item.
        import ctranslate2
        import sentencepiece
        from huggingface_hub import snapshot_download

        path = Path(snapshot_download(
            "quickmt/quickmt-fr-en",
            ignore_patterns="eole-model/*",
            cache_dir=str(MODEL_DIR),
        ))
        device = os.environ.get("READR_DEVICE", "auto")
        mt = ctranslate2.Translator(str(path), device=device)
        src = sentencepiece.SentencePieceProcessor(model_file=str(path / "src.spm.model"))
        tgt = sentencepiece.SentencePieceProcessor(model_file=str(path / "tgt.spm.model"))

        def run(sentences: list[str]) -> list[str]:
            tokens = [t + ["</s>"] for t in src.encode(sentences, out_type=str)]
            results = mt.translate_batch(
                tokens,
                beam_size=int(os.environ.get("READR_BEAM", "4")),
                max_batch_size=32,
                max_decoding_length=256,
                disable_unk=True,
            )
            return tgt.decode([r.hypotheses[0] for r in results])

        self.translate_fn = run
        self.translator_name = "quickmt-fr-en"

    def _load_opus(self) -> None:
        from transformers import MarianMTModel, MarianTokenizer

        name = "Helsinki-NLP/opus-mt-fr-en"
        tok = MarianTokenizer.from_pretrained(name, cache_dir=str(MODEL_DIR))
        model = MarianMTModel.from_pretrained(name, cache_dir=str(MODEL_DIR))
        model.eval()

        def run(sentences: list[str]) -> list[str]:
            import torch

            with torch.no_grad():
                batch = tok(sentences, return_tensors="pt", padding=True, truncation=True, max_length=512)
                gen = model.generate(**batch, num_beams=4, max_new_tokens=512)
            return tok.batch_decode(gen, skip_special_tokens=True)

        self.translate_fn = run
        self.translator_name = "opus-mt-fr-en"

    def _load_translator(self) -> None:
        forced = os.environ.get("READR_TRANSLATOR", "").lower()
        order = [forced] if forced else ["quickmt", "opus"]
        for name in order:
            try:
                (self._load_quickmt if name == "quickmt" else self._load_opus)()
                log.info("translator ready: %s", self.translator_name)
                return
            except Exception as exc:  # noqa: BLE001 - try the next engine
                msg = f"{name}: {exc.__class__.__name__}: {exc}"
                log.warning("translator unavailable (%s)", msg)
                self.errors.append(msg)

    # -- language analysis -----------------------------------------------------
    def _load_spacy(self) -> None:
        try:
            import spacy

            self.nlp = spacy.load("fr_core_news_sm", disable=["ner"])
            log.info("spaCy ready")
        except Exception as exc:  # noqa: BLE001
            self.errors.append(f"spaCy: {exc}")
            log.warning("spaCy unavailable: %s", exc)

    def _load_dictionary(self) -> None:
        if DICT_PATH.exists():
            self.dictionary = Dictionary(DICT_PATH)
            log.info("dictionary ready: %s", DICT_PATH.name)
        else:
            log.info("no dictionary at %s (run build_dict.py to add one)", DICT_PATH)

    def load_all(self) -> None:
        self._load_spacy()
        self._load_dictionary()
        self._load_translator()
        self.ready.set()

    def translate(self, sentences: list[str]) -> list[str]:
        if not self.ready.wait(timeout=600):
            raise HTTPException(503, "Models are still loading.")
        if self.translate_fn is None:
            raise HTTPException(503, "No translation engine could be loaded: " + "; ".join(self.errors))
        with self.lock:
            return self.translate_fn(sentences)


# --------------------------------------------------------------------------- dictionary


class Dictionary:
    """Read-only access to the SQLite file produced by build_dict.py."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.local = threading.local()

    def _conn(self) -> sqlite3.Connection:
        conn = getattr(self.local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
            self.local.conn = conn
        return conn

    def entries(self, word: str) -> list[dict]:
        rows = self._conn().execute(
            "SELECT word, pos, glosses, tags, ipa, form_of FROM entries WHERE key = ? ORDER BY rank",
            (word.lower(),),
        ).fetchall()
        # Prefer exact-case matches ("Paris" vs "paris") when both exist.
        exact = [r for r in rows if r[0] == word]
        return [
            {
                "word": r[0],
                "pos": r[1],
                "glosses": json.loads(r[2]),
                "tags": json.loads(r[3]),
                "ipa": r[4] or "",
                "form_of": r[5] or "",
            }
            for r in (exact or rows)
        ]


SPACY_TO_WIKT = {
    "NOUN": "noun", "PROPN": "name", "VERB": "verb", "AUX": "verb", "ADJ": "adj", "ADV": "adv",
    "PRON": "pron", "DET": "det", "ADP": "prep", "CCONJ": "conj", "SCONJ": "conj", "NUM": "num", "INTJ": "intj",
}


def senses_for(dictionary: Dictionary, word: str, lemma: str, pos: str) -> tuple[list[dict], str]:
    """Dictionary senses for the lemma (falling back to the surface form) and an IPA string."""
    surface = dictionary.entries(word)
    lemma_entries = dictionary.entries(lemma) if lemma and lemma.lower() != word.lower() else []
    # If spaCy gave no lemma, follow Wiktionary's own "form of" links.
    if not lemma_entries:
        targets = {e["form_of"] for e in surface if e["form_of"]}
        for target in targets:
            lemma_entries += dictionary.entries(target)

    pool = [e for e in lemma_entries + surface if e["glosses"] and not e["form_of"]] or surface
    wanted = SPACY_TO_WIKT.get(pos)
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
_cache: "OrderedDict[str, str]" = OrderedDict()
_CACHE_MAX = 20_000


class TranslateIn(BaseModel):
    sentences: list[str]
    src: str = "fr"
    tgt: str = "en"


class LookupIn(BaseModel):
    word: str
    sentence: str = ""
    lang: str = "fr"


@app.get("/health")
def health() -> dict:
    loading = not engines.ready.is_set()
    ok = engines.translate_fn is not None
    if loading:
        message = "Loading models (the first run downloads ~200 MB)…"
    elif not ok:
        message = "No translation engine: " + "; ".join(engines.errors)
    else:
        message = "Ready"
    return {
        "ok": ok,
        "translator": engines.translator_name,
        "spacy": engines.nlp is not None,
        "dictionary": engines.dictionary is not None,
        "message": message,
    }


def translate_cached(sentences: list[str]) -> list[str]:
    todo = [s for s in dict.fromkeys(sentences) if s not in _cache and s.strip()]
    if todo:
        for s, t in zip(todo, engines.translate(todo)):
            _cache[s] = t
            if len(_cache) > _CACHE_MAX:
                _cache.popitem(last=False)
    return [_cache.get(s, "") for s in sentences]


@app.post("/translate")
def translate(body: TranslateIn) -> dict:
    if body.src != "fr" or body.tgt != "en":
        raise HTTPException(400, "Only French → English is set up.")
    return {"translations": translate_cached(body.sentences)}


def analyse(word: str, sentence: str) -> tuple[str, str, dict]:
    """Lemma, UPOS tag and morphology for `word` as used in `sentence`."""
    if engines.nlp is None:
        return word, "", {}
    doc = engines.nlp(sentence or word)
    target = word.lower().rstrip("'’")
    token = next((t for t in doc if t.text.lower().rstrip("'’") == target), None)
    if token is None:  # word not found in the sentence: analyse it alone
        token = engines.nlp(word)[0]
    return token.lemma_, token.pos_, token.morph.to_dict()


@app.post("/lookup")
def lookup(body: LookupIn) -> dict:
    word = body.word.strip()
    if not word:
        raise HTTPException(400, "Empty word.")
    engines.ready.wait(timeout=120)
    lemma, pos, morph = analyse(word, body.sentence)

    senses, ipa = ([], "")
    if engines.dictionary is not None:
        senses, ipa = senses_for(engines.dictionary, word, lemma, pos)

    mt_gloss = ""
    if engines.translate_fn is not None:
        try:
            # Verbs read better from the infinitive; everything else as written.
            mt_gloss = translate_cached([lemma if pos in ("VERB", "AUX") and lemma else word])[0]
        except Exception:  # noqa: BLE001 - the gloss is optional
            mt_gloss = ""

    return {
        "word": word,
        "lemma": lemma,
        "pos": pos,
        "morph": morph,
        "ipa": ipa,
        "senses": senses,
        "mtGloss": mt_gloss,
        "dictionaryAvailable": engines.dictionary is not None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    threading.Thread(target=engines.load_all, daemon=True).start()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
