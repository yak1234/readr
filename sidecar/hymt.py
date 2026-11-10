"""Hy-MT2 translation (Tencent Hy-MT2-1.8B, 8-bit MLX build by default) for the Readr server.

Prompt templates are copied from the model card, section "Hy-MT2 Translation Task
Instruction Examples" (https://huggingface.co/tencent/Hy-MT2-1.8B), English column:
  - "Default Translation"  -> PLAIN_TEMPLATE
  - "Structured Data 2" (background information) -> CONTEXT_TEMPLATE
The card's markdown bold markers are formatting only and are not part of the prompt
(the mlx-community card's quick start uses the plain text without them).
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path

import runtime

LANGUAGES_PATH = runtime.languages_path()
DEFAULT_MODEL_ID = "mlx-community/Hy-MT2-1.8B-8bit"
MODEL_ID = os.environ.get("READR_TRANSLATOR_MODEL", DEFAULT_MODEL_ID)
# Card's recommended max_tokens; decoding is greedy (sampling params are not used) and
# generation ends at the end-of-sequence token long before this for one sentence.
MAX_TOKENS = 4096


def max_tokens_for(source_tokens: int) -> int:
    """Per-sentence generation cap: a translation is a few times its source's length, so a
    looping generation is cut off long before the card's limit (the lock is global)."""
    return min(MAX_TOKENS, 3 * source_tokens + 32)

PLAIN_TEMPLATE = (
    "Translate the following text into {target_lang}. Note that you should "
    "only output the translated result without any additional explanation:\n\n{source_text}"
)
CONTEXT_TEMPLATE = (
    "[Background Information]\n{background_text}\n\n"
    "Please translate the following text into {target_lang}, taking the provided "
    "background information into consideration.\n\n"
    "[Source Text]\n{source_text}"
)

_languages: dict | None = None


def languages() -> dict:
    global _languages
    if _languages is None:
        _languages = json.loads(LANGUAGES_PATH.read_text(encoding="utf-8"))
    return _languages


def is_supported(code: str) -> bool:
    return bool(languages().get(code, {}).get("translate"))


def language_name(code: str) -> str:
    return languages()[code]["name"]


def build_prompt(text: str, src: str, tgt: str, context: list[str]) -> str:
    """The user message for one sentence. `context` is the preceding sentences, oldest first."""
    target = language_name(tgt)
    if context:
        return CONTEXT_TEMPLATE.format(
            target_lang=target, background_text="\n".join(context), source_text=text
        )
    return PLAIN_TEMPLATE.format(target_lang=target, source_text=text)


_HEADER = re.compile(r"^\s*\[[^\]\n]{3,40}\]\s*\n")


def echoes_context(result: str, text: str) -> bool:
    """True when the model repeated the prompt's "[Background Information]" header (in any
    language) instead of translating just the source text."""
    return bool(_HEADER.match(result)) and not text.lstrip().startswith("[")


class HyMt:
    """Loads Hy-MT2 with mlx-lm (default Hugging Face cache) and translates one sentence at a time."""

    def __init__(self, model_id: str | None = None) -> None:
        self.model_id = model_id or MODEL_ID
        unavailable = runtime.translator_available()
        if unavailable:
            raise RuntimeError(unavailable)
        from mlx_lm import generate, load
        from mlx_lm.sample_utils import make_sampler

        self._generate = generate
        self._sampler = make_sampler(temp=0.0)  # greedy
        self.model, self.tokenizer = load(self.model_id)
        self.lock = threading.Lock()
        self.translate([("Bonjour.", [])], "fr", "en")  # warm-up

    def translate(self, items: list[tuple[str, list[str]]], src: str, tgt: str) -> list[str]:
        out = []
        with self.lock:
            for text, context in items:
                if not text.strip():
                    out.append("")
                    continue
                prompt = self.tokenizer.apply_chat_template(
                    [{"role": "user", "content": build_prompt(text, src, tgt, context)}],
                    add_generation_prompt=True,
                    tokenize=False,
                )
                cap = max_tokens_for(len(self.tokenizer.encode(text)))
                result = self._generate(
                    self.model, self.tokenizer, prompt=prompt, max_tokens=cap, sampler=self._sampler
                )
                result = result.strip()
                if context and echoes_context(result, text):
                    # The context leaked into the answer; translate the sentence on its own.
                    prompt = self.tokenizer.apply_chat_template(
                        [{"role": "user", "content": build_prompt(text, src, tgt, [])}],
                        add_generation_prompt=True,
                        tokenize=False,
                    )
                    result = self._generate(
                        self.model, self.tokenizer, prompt=prompt, max_tokens=cap, sampler=self._sampler
                    ).strip()
                out.append(result)
        return out
