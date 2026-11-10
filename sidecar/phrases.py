"""Phrase snapping: widen a selected word to the dictionary's multi-word entry it belongs to.

Selecting "cause" in "Il a mis en cause le ministre" should give "mis en cause" (mettre en cause), not the
noun. The search here is pure: tokens in, a chosen span out. The dictionary is a `lookup` callable and the
tokens come from Stanza (or the surface fallback below), so nothing in this module loads a model or a file.

Offsets are character (code point) offsets into the sentence, as Python counts them.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Callable, Optional

MAX_PHRASE = 6  # tokens in the longest phrase searched; Wiktionary's multi-word headwords are rarely longer


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int
    lemma: str  # the dictionary form; the surface text when there is no analysis
    is_word: bool  # False for punctuation: a phrase never spans it


@dataclass(frozen=True)
class Hit:
    first: int  # index of the first token of the span
    end: int  # one past the last token
    entry: dict  # the dictionary entry the span matched


def _is_word(text: str) -> bool:
    return any(c.isalnum() for c in text)


def tokens_from_analysis(sentence: str, analysed: list[dict]) -> list[Token]:
    """Tokens from analysis.analyse(): the lemma of each is that of the part a learner means."""
    import analysis

    out = []
    for t in analysed:
        lemma = analysis.pick_part(t)["lemma"] if t["parts"] else t["text"]
        out.append(Token(t["text"], t["start"], t["end"], lemma, _is_word(t["text"])))
    return out


def surface_tokens(sentence: str) -> list[Token]:
    """Words of `sentence` without any analysis: runs of letters, digits and combining marks, joined by
    an apostrophe or hyphen inside a word (aujourd'hui, peut-être)."""

    def inside(i: int) -> bool:
        c = sentence[i]
        return c.isalnum() or unicodedata.category(c).startswith("M")

    out, i, n = [], 0, len(sentence)
    while i < n:
        if not inside(i):
            i += 1
            continue
        j = i
        while j < n and (inside(j) or (sentence[j] in "'’-" and j + 1 < n and inside(j + 1) and j > i)):
            j += 1
        out.append(Token(sentence[i:j], i, j, sentence[i:j], True))
        i = j
    return out


def selected(tokens: list[Token], start: int, end: int) -> tuple[int, int]:
    """Indices [first, end) of the tokens the character range [start, end) touches; empty if none."""
    hit = [i for i, t in enumerate(tokens) if t.start < end and t.end > start]
    return (hit[0], hit[-1] + 1) if hit else (0, 0)


def spans(count: int, first: int, end: int, max_len: int = MAX_PHRASE) -> list[tuple[int, int]]:
    """Token spans of 2..max_len tokens that fully contain tokens [first, end), longest first, then leftmost."""
    out = []
    for length in range(min(max_len, count), 1, -1):
        for a in range(max(0, end - length), min(first, count - length) + 1):
            out.append((a, a + length))
    return out


def _keys(sentence: str, tokens: list[Token], a: int, b: int, key: Callable[[str], str]) -> list[str]:
    """Lookup keys for tokens [a, b): the surface text as written, then the lemmas."""
    surface = " ".join(sentence[tokens[a].start : tokens[b - 1].end].split())
    lemmas = " ".join(t.lemma for t in tokens[a:b])
    keys = [key(surface), key(lemmas)]
    if b - a == 1:
        keys.reverse()  # a single word means its dictionary form
    return list(dict.fromkeys(keys))


def snap(
    sentence: str,
    tokens: list[Token],
    first: int,
    end: int,
    lookup: Callable[[list[str]], dict[str, dict]],
    key: Callable[[str], str],
) -> Optional[Hit]:
    """The longest dictionary entry (ties: the leftmost) covering the selected tokens [first, end).

    One `lookup(keys)` call covers every candidate. A single selected word is also a candidate, so its own
    entry comes back when no phrase matches. None when nothing matches, or when a candidate would span
    punctuation."""
    candidates = [
        (a, b) for a, b in spans(len(tokens), first, end) if all(t.is_word for t in tokens[a:b])
    ]
    if end - first == 1 and tokens[first].is_word:
        candidates.append((first, end))
    if not candidates:
        return None
    keyed = {(a, b): _keys(sentence, tokens, a, b, key) for a, b in candidates}
    found = lookup(list(dict.fromkeys(k for ks in keyed.values() for k in ks)))
    for span in candidates:  # already longest first, then leftmost
        for k in keyed[span]:
            if k in found:
                return Hit(span[0], span[1], found[k])
    return None
