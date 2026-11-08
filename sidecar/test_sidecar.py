"""Tests for the sidecar API and dictionary builder.

They swap in a stub translator, so no model download is needed:
    python -m pytest test_sidecar.py
"""

import gzip
import json

import pytest
from fastapi.testclient import TestClient

import build_dict
import server

ENTRIES = [
    {"word": "économie", "lang": "French", "lang_code": "fr", "pos": "noun",
     "sounds": [{"ipa": "/e.kɔ.nɔ.mi/"}],
     "senses": [{"glosses": ["economy"], "tags": ["feminine"]}, {"glosses": ["saving"]}]},
    {"word": "économies", "lang": "French", "lang_code": "fr", "pos": "noun",
     "senses": [{"glosses": ["plural of économie"], "form_of": [{"word": "économie"}], "tags": ["plural"]}]},
    {"word": "lire", "lang": "French", "lang_code": "fr", "pos": "verb",
     "sounds": [{"ipa": "/liʁ/"}], "senses": [{"glosses": ["to read"]}]},
    {"word": "lit", "lang": "French", "lang_code": "fr", "pos": "noun",
     "senses": [{"glosses": ["bed"], "tags": ["masculine"]}]},
    {"word": "lit", "lang": "French", "lang_code": "fr", "pos": "verb",
     "senses": [{"glosses": ["third-person singular present indicative of lire"], "form_of": [{"word": "lire"}]}]},
    # Other languages in the raw dump must be skipped.
    {"word": "economy", "lang": "English", "lang_code": "en", "pos": "noun", "senses": [{"glosses": ["x"]}]},
]


@pytest.fixture(scope="module")
def dict_path(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("dict")
    src = tmp / "fr.jsonl.gz"
    with gzip.open(src, "wt", encoding="utf-8") as fh:
        for e in ENTRIES:
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")
    out = tmp / "fr-en.sqlite"
    build_dict.build(src, out)
    return out


@pytest.fixture()
def client(dict_path):
    calls = []

    def fake_translate(sentences):
        calls.append(list(sentences))
        return [f"EN<{s}>" for s in sentences]

    server.engines.translate_fn = fake_translate
    server.engines.translator_name = "stub"
    server.engines.nlp = None  # exercise the no-spaCy path
    server.engines.dictionary = server.Dictionary(dict_path)
    server.engines.ready.set()
    server._cache.clear()
    c = TestClient(server.app)
    c.calls = calls
    return c


def test_builder_keeps_only_french(dict_path):
    d = server.Dictionary(dict_path)
    assert d.entries("economy") == []
    assert [e["pos"] for e in d.entries("lit")] == ["noun", "verb"]


def test_health_reports_engines(client):
    body = client.get("/health").json()
    assert body == {"ok": True, "translator": "stub", "spacy": False, "dictionary": True, "message": "Ready"}


def test_translate_preserves_order_and_caches(client):
    r = client.post("/translate", json={"sentences": ["Bonjour.", "Merci.", "Bonjour."]}).json()
    assert r["translations"] == ["EN<Bonjour.>", "EN<Merci.>", "EN<Bonjour.>"]
    client.post("/translate", json={"sentences": ["Merci."]})
    assert client.calls == [["Bonjour.", "Merci."]]  # duplicates and repeats never re-translated


def test_translate_rejects_other_pairs(client):
    assert client.post("/translate", json={"sentences": ["x"], "src": "ar"}).status_code == 400


def test_lookup_follows_form_of_to_lemma(client):
    r = client.post("/lookup", json={"word": "économies", "sentence": "Les économies d'énergie."}).json()
    glosses = [g for s in r["senses"] for g in s["glosses"]]
    assert "economy" in glosses and "saving" in glosses
    assert not any(g.startswith("plural of") for g in glosses)
    assert r["ipa"] == "/e.kɔ.nɔ.mi/"
    assert r["dictionaryAvailable"] is True
    assert r["mtGloss"] == "EN<économies>"


def test_lookup_prefers_spacy_pos(client, monkeypatch):
    monkeypatch.setattr(server, "analyse", lambda w, s: ("lire", "VERB", {"Tense": "Pres", "Person": "3"}))
    r = client.post("/lookup", json={"word": "lit", "sentence": "Elle lit le journal."}).json()
    assert r["lemma"] == "lire"
    assert r["senses"][0]["glosses"][0] == "to read"  # verb sense before "bed"
    assert r["morph"] == {"Tense": "Pres", "Person": "3"}
    assert r["mtGloss"] == "EN<lire>"  # verbs glossed from the infinitive


def test_lookup_without_dictionary_still_answers(client):
    server.engines.dictionary = None
    r = client.post("/lookup", json={"word": "journal", "sentence": "Le journal."}).json()
    assert r["senses"] == [] and r["mtGloss"] == "EN<journal>" and r["dictionaryAvailable"] is False
