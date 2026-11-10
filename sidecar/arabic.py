"""Arabic normalisation, applied to both dictionary keys and lookups so vocalised and bare spellings meet."""

from __future__ import annotations

import re
import unicodedata

# Harakat and Quranic annotation marks (U+0610-061A, U+064B-065F), dagger alif (U+0670), tatweel (U+0640).
_MARKS = re.compile("[ؐ-ًؚ-ٰٟـ]")
_ALEFS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا"})


def normalise(text: str) -> str:
    """NFC, no harakat/tatweel/dagger alif, and أ إ آ ٱ unified to ا."""
    text = unicodedata.normalize("NFC", text)
    return unicodedata.normalize("NFC", _MARKS.sub("", text).translate(_ALEFS))
