// What a flashcard can sound like: its word said by Magpie, and its example sentence — the radio or TV clip
// it was heard in when there is one, otherwise Magpie reading the sentence. Nothing for a language Magpie
// can't speak (and no clip).

import type { Card, CardExample } from "../../shared/cards";
import { languageInfo } from "../../shared/languages";

export type CardSound = { kind: "clip"; bytes: Uint8Array } | { kind: "speech"; text: string; lang: string };

/** A part of a card that plays, named so its button can show it playing. */
export interface CardPart {
  id: string;
  sound: CardSound | null;
}

export function wordSound(card: Pick<Card, "form" | "lang">): CardSound | null {
  return languageInfo(card.lang).speak && card.form.trim() ? { kind: "speech", text: card.form, lang: card.lang } : null;
}

export function sentenceSound(card: Pick<Card, "lang">, example: Pick<CardExample, "sentence" | "clip">): CardSound | null {
  if (example.clip && example.clip.length > 0) return { kind: "clip", bytes: example.clip };
  return languageInfo(card.lang).speak && example.sentence.trim() ? { kind: "speech", text: example.sentence, lang: card.lang } : null;
}
