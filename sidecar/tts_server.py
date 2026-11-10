"""Readr read-aloud server: NVIDIA Magpie TTS (multilingual, 357M) via NeMo.

Runs in its own environment (sidecar/.venv-tts) because NeMo pins heavy
dependencies. 127.0.0.1 only:
  GET  /health  -> {"ok", "message"}
  GET  /voices  -> {"voices": [...], "ready": bool}
  POST /speak   -> {"text", "lang": "fr"|"en"|"ar", "voice", "quality": "fast"|"best"} -> audio/wav

"fast" turns classifier-free guidance off (about real time on Apple silicon);
"best" keeps it on (about 1.3x slower), used for single words.
"""

from __future__ import annotations

import argparse
import atexit
import io
import json
import logging
import os
import subprocess
import threading
import time
import urllib.request
import wave
from collections import OrderedDict
from pathlib import Path
from typing import Optional, Protocol, Sequence

import lifeline
import runtime
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

log = logging.getLogger("readr-tts")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

SPEAKERS = {"Aria": 0, "Jason": 1, "John": 2, "Leo": 3, "Sofia": 4}
DEFAULT_VOICE = "Sofia"
LANGS = {"fr", "en", "ar", "de", "es", "it", "pt", "zh", "ja", "ko", "hi", "vi"}


class Engine(Protocol):
    voices: list[str]

    def speak(self, text: str, lang: str, voice: str, quality: str) -> tuple[Sequence[float], int]: ...


def tokenizer_for(lang: str, available: list[str], nemo_choice) -> str:
    """NeMo 3.0.0 maps Arabic to the English phoneme tokenizer although the
    checkpoint ships Arabic ones (added in Magpie v2607); use Modern Standard
    Arabic when it's there, otherwise NeMo's own choice."""
    if lang == "ar" and "arabic_MSA_chartokenizer" in available:
        return "arabic_MSA_chartokenizer"
    return nemo_choice(lang, available)


class MagpieEngine:
    voices = list(SPEAKERS)

    def __init__(self) -> None:
        import torch
        import nemo.collections.tts.models.magpietts as magpietts
        from nemo.collections.tts.models import MagpieTTSModel

        nemo_choice = magpietts.get_tokenizer_for_language
        magpietts.get_tokenizer_for_language = lambda lang, keys: tokenizer_for(lang, list(keys), nemo_choice)

        self.torch = torch
        self.model = MagpieTTSModel.from_pretrained("nvidia/magpie_tts_multilingual_357m").eval()
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model.to(self.device)
        self.rate = int(getattr(self.model, "output_sample_rate", 0) or getattr(self.model, "sample_rate", 0) or 22050)

    def speak(self, text: str, lang: str, voice: str, quality: str) -> tuple[Sequence[float], int]:
        with self.torch.inference_mode():
            audio, length = self.model.do_tts(
                text, language=lang, apply_TN=True, use_cfg=quality == "best", speaker_index=SPEAKERS[voice]
            )
        return audio[0, : int(length[0])].float().cpu().numpy(), self.rate


CPP_LANGS = {"fr": "fr-FR", "en": "en-US", "ar": "ar-MSA", "de": "de-DE", "es": "es-ES", "it": "it-IT", "pt": "pt-BR", "hi": "hi-IN", "vi": "vi-VN", "ko": "ko-KR"}


def cpp_language(lang: str) -> str:
    return CPP_LANGS.get(lang, lang)


runners: "list[subprocess.Popen]" = []  # every speech runner this server started


def stop_runners() -> None:
    """Stops the speech runners (they hold the models on the GPU, and a port)."""
    for proc in runners:
        if proc.poll() is None:
            proc.terminate()


class CppEngine:
    """NVIDIA's NeMo-Speech.cpp runner (on Apple silicon: Metal, about 2.5x faster
    than real time). Runs as a child HTTP server; Readr's server keeps
    doing normalisation and caching in front of it. It also loads Nemotron 3.5
    speech recognition, which Readr's main process uses directly for live
    transcripts (port + 1)."""

    voices = list(SPEAKERS)

    def __init__(self, port: int, start: bool = True, binary: Optional[Path] = None, device: str = "metal") -> None:
        self.base = f"http://127.0.0.1:{port}"
        self.proc: Optional[subprocess.Popen] = None
        if start and self._ready():
            return  # left running by an earlier session that was force-quit
        if start:
            self.proc = subprocess.Popen(
                [str(binary), "serve", *runtime.speech_model_args(), "--port", str(port), "--no-ui", "--device", device, "--quiet"],
                stdin=subprocess.DEVNULL,
            )
            # Known from the moment it exists, not once it is ready (loading takes a while): whatever ends this
            # server meanwhile must still be able to stop it.
            runners.append(self.proc)
            atexit.register(self.close)
            deadline = time.time() + 600  # first run downloads the model
            while time.time() < deadline:
                if self.proc.poll() is not None:
                    raise RuntimeError(f"NeMo-Speech.cpp exited with code {self.proc.returncode}")
                if self._ready():
                    return
                time.sleep(1)
            self.close()
            raise RuntimeError("NeMo-Speech.cpp didn't become ready")

    def _ready(self) -> bool:
        try:
            with urllib.request.urlopen(f"{self.base}/ready", timeout=2) as r:
                return bool(json.loads(r.read()).get("ready"))
        except (OSError, ValueError):
            return False

    def speak_wav(self, text: str, lang: str, voice: str, quality: str) -> bytes:
        body = json.dumps({"input": text, "voice": voice, "language": cpp_language(lang)}).encode()
        req = urllib.request.Request(f"{self.base}/v1/audio/speech", data=body, headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()

    def close(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


class State:
    def __init__(self) -> None:
        self.ready = threading.Event()
        self.engine: Optional[Engine] = None
        self.error = ""
        self.unavailable = False  # this computer has no way to run the voice
        self.lock = threading.Lock()  # one synthesis at a time on the GPU


state = State()
cache: "OrderedDict[tuple, bytes]" = OrderedDict()
CACHE_MAX = 200
app = FastAPI(title="Readr TTS")


UNAVAILABLE = "Read-aloud isn't available on this computer yet."


def load(runner_port: int) -> None:
    runner = runtime.speech_runner()
    try:
        if runner and not os.environ.get("READR_TTS_PYTHON_ENGINE"):
            state.engine = CppEngine(runner_port, binary=runner[0], device=runner[1])  # it warms up itself
        else:
            state.engine = MagpieEngine()
            # Warm up so the first real sentence isn't slow.
            state.engine.speak("Bonjour.", "fr", DEFAULT_VOICE, "fast")
        log.info("Magpie ready")
    except Exception as exc:  # noqa: BLE001 - reported through /health
        if runner is None and isinstance(exc, ImportError):
            # No speech runner for this computer, and the Python voice isn't installed either.
            state.unavailable = True
        state.error = f"{exc.__class__.__name__}: {exc}"
        log.error("Magpie failed to load: %s", state.error)
    finally:
        state.ready.set()


def to_wav(samples: Sequence[float], rate: int) -> bytes:
    import array

    pcm = array.array("h", (int(max(-1.0, min(1.0, float(s))) * 32767) for s in samples))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# ---- text normalisation
# NeMo's own normaliser needs pynini/OpenFst, which has no macOS wheel, so the
# essentials are done here: numbers, decimals, percentages, currencies, titles.

TITLES = {
    "fr": [(r"\bMM\.", "Messieurs"), (r"\bMme\b\.?", "Madame"), (r"\bMlle\b\.?", "Mademoiselle"), (r"\bM\.(?=\s)", "Monsieur"), (r"\bDr\b\.?", "Docteur"), (r"\bPr\b\.?", "Professeur")],
    "en": [(r"\bMr\.", "Mister"), (r"\bMrs\.", "Missus"), (r"\bDr\.", "Doctor")],
}
UNITS = {
    "fr": {"%": "pour cent", "€": "euros", "$": "dollars", "£": "livres"},
    "en": {"%": "percent", "€": "euros", "$": "dollars", "£": "pounds"},
    "ar": {"%": "بالمئة", "€": "يورو", "$": "دولار", "£": "جنيه"},
}
DECIMAL = {"fr": "virgule", "en": "point", "ar": "فاصلة"}
_NUMBER = r"\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+"


def _spell(n: str, lang: str) -> str:
    from num2words import num2words

    try:
        return num2words(int(n), lang=lang)
    except (NotImplementedError, OverflowError, ValueError):
        return n


def normalise(text: str, lang: str) -> str:
    """Spell out what the voice would otherwise read digit by digit or skip."""
    import re

    if lang not in UNITS:
        return text
    for pattern, word in TITLES.get(lang, []):
        text = re.sub(pattern, word, text)
    units = UNITS[lang]

    def number(m: "re.Match[str]") -> str:
        whole = re.sub(r"[ \u00a0\u202f]", "", m.group(1))
        words = _spell(whole, lang)
        if m.group(2):
            words += f" {DECIMAL[lang]} " + _spell(m.group(2), lang)
        unit = m.group(3)
        return words + (f" {units[unit]}" if unit else "")

    unit_chars = "".join(re.escape(u) for u in units)
    text = re.sub(rf"(?<![\w,.])({_NUMBER})(?:[,.](\d+))?\s?([{unit_chars}])?(?!\w)", number, text)
    return re.sub(r"\s{2,}", " ", text).strip()


class SpeakIn(BaseModel):
    text: str
    lang: str = "fr"
    voice: str = DEFAULT_VOICE
    quality: str = "fast"


@app.get("/health")
def health() -> dict:
    if not state.ready.is_set():
        return {"app": "readr", "ok": False, "message": "Loading the Magpie voice (the first run downloads about 1.4 GB)…"}
    if state.engine is None:
        return {"app": "readr", "ok": False, "message": UNAVAILABLE if state.unavailable else f"The voice couldn't load: {state.error}"}
    return {"app": "readr", "ok": True, "message": "Ready"}


@app.get("/voices")
def voices() -> dict:
    ready = state.ready.is_set() and state.engine is not None
    return {"voices": state.engine.voices if state.engine else list(SPEAKERS), "ready": ready}


@app.post("/speak")
def speak(body: SpeakIn) -> Response:
    text = " ".join(body.text.split())
    if not text:
        raise HTTPException(400, "Nothing to say.")
    if body.lang not in LANGS:
        raise HTTPException(400, f"Magpie doesn't speak '{body.lang}'.")
    if not state.ready.is_set() or state.engine is None:
        raise HTTPException(503, health()["message"])
    voice = body.voice if body.voice in state.engine.voices else DEFAULT_VOICE
    quality = "best" if body.quality == "best" else "fast"
    key = (text, body.lang, voice, quality)
    wav = cache.get(key)
    if wav is None:
        said = normalise(text, body.lang)
        if hasattr(state.engine, "speak_wav"):
            wav = state.engine.speak_wav(said, body.lang, voice, quality)
        else:
            with state.lock:
                samples, rate = state.engine.speak(said, body.lang, voice, quality)
            wav = to_wav(samples, rate)
        cache[key] = wav
        if len(cache) > CACHE_MAX:
            cache.popitem(last=False)
    else:
        cache.move_to_end(key)
    return Response(content=wav, media_type="audio/wav")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("READR_TTS_PORT", "8766")))
    parser.add_argument("--runner-port", type=int, default=None, help="the speech runner's port (default: one above --port)")
    args = parser.parse_args()
    lifeline.watch(stop_runners)
    threading.Thread(target=load, args=(args.runner_port or args.port + 1,), daemon=True).start()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
