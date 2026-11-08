// Turns YouTube captions into timed sentences. YouTube's "json3" format gives a
// start time for every word, so sentences can be cut with the same splitter as
// articles and still know exactly when each one is spoken.

import { splitSentences } from "./segment";

export interface Word {
  text: string; // includes its leading space, as YouTube sends it
  start: number; // seconds
}

export interface Cue {
  text: string;
  start: number; // seconds
  end: number; // seconds
}

interface Json3 {
  events?: { tStartMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[];
}

export function parseJson3(data: Json3): Word[] {
  const words: Word[] = [];
  for (const event of data.events ?? []) {
    const base = event.tStartMs ?? 0;
    for (const seg of event.segs ?? []) {
      const text = (seg.utf8 ?? "").replace(/\n/g, " ");
      if (!text.trim()) continue;
      // Manual captions put a whole line in one segment; start a new word boundary
      // between events so lines don't run together.
      const prev = words[words.length - 1];
      const needsSpace = prev && !/^\s/.test(text) && seg.tOffsetMs === undefined;
      words.push({ text: needsSpace ? ` ${text}` : text, start: (base + (seg.tOffsetMs ?? 0)) / 1000 });
    }
  }
  return words;
}

/** A sentence longer than this many words is split at a comma, or failing that,
 * evenly, so a cue fits on screen and is a sensible unit to loop. */
const MAX_WORDS = 28;
/** How long the last word of a sentence is assumed to last when speech pauses. */
const TAIL = 0.6;
const MAX_GAP = 1.5;

export function wordsToCues(words: Word[], lang = "fr"): Cue[] {
  if (words.length === 0) return [];

  // Join the words and remember where each one starts in the joined text.
  let text = "";
  const offsets: number[] = [];
  for (const w of words) {
    offsets.push(text.length + (w.text.length - w.text.trimStart().length));
    text += w.text;
  }

  // Map each sentence back to the index of its first word.
  const firstWords: number[] = [];
  const sentences: string[] = [];
  let cursor = 0;
  let wi = 0;
  for (const sentence of splitSentences(text, lang)) {
    const at = text.indexOf(sentence, cursor);
    if (at < 0) continue;
    cursor = at + sentence.length;
    while (wi < offsets.length - 1 && offsets[wi + 1] <= at) wi++;
    firstWords.push(wi);
    sentences.push(sentence);
  }

  const wordEnd = (i: number): number => {
    const next = words[i + 1];
    return next && next.start - words[i].start < MAX_GAP ? next.start : words[i].start + TAIL;
  };

  const cues: Cue[] = [];
  sentences.forEach((sentence, si) => {
    const first = firstWords[si];
    const last = (si + 1 < firstWords.length ? firstWords[si + 1] : words.length) - 1;
    for (const [a, b] of splitLong(words, first, last)) {
      const piece = words.slice(a, b + 1).map((w) => w.text).join("").replace(/\s+/g, " ").trim();
      if (piece) cues.push({ text: piece, start: words[a].start, end: wordEnd(b) });
    }
  });
  return cues;
}

/** Ranges [a, b] of word indexes, each at most MAX_WORDS long. */
function splitLong(words: Word[], first: number, last: number): [number, number][] {
  const out: [number, number][] = [];
  let a = first;
  while (last - a + 1 > MAX_WORDS) {
    // Prefer the last comma in the back half of the allowed window.
    let cut = -1;
    for (let i = a + MAX_WORDS - 1; i >= a + Math.floor(MAX_WORDS / 2); i--) {
      if (/[,;:]\s*$/.test(words[i].text)) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = a + Math.ceil((last - a + 1) / Math.ceil((last - a + 1) / MAX_WORDS)) - 1;
    out.push([a, cut]);
    a = cut + 1;
  }
  out.push([a, last]);
  return out;
}

/** Index of the cue playing at `time`, or the last one that started before it. */
export function cueAt(cues: Cue[], time: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
