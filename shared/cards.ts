// Flashcard helpers shared by the main process and the renderer.

// Hebrew niqqud and cantillation (U+0591–U+05C7); Arabic Quranic annotation marks (U+0610–U+061A),
// harakat (U+064B–U+065F), dagger alif (U+0670) and tatweel (U+0640).
const MARKS = /[֑-ׇؐ-ًؚ-ٰٟـ]/g;
const ALEFS: Record<string, string> = { "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا" };

/**
 * A card's identity key for its dictionary form. A port of the sidecar's `norm_key`
 * (sidecar/build_dict.py with sidecar/arabic.py): lowercase, NFC, optional vowel marks and
 * tatweel removed, أ إ آ ٱ unified to ا, so card keys meet the dictionary's keys. Unlike a
 * single dictionary word, a form may be a phrase, so whitespace is also collapsed and trimmed.
 */
export function normKey(form: string): string {
  const bare = form.toLowerCase().normalize("NFC").replace(MARKS, "").replace(/[أإآٱ]/g, (c) => ALEFS[c]);
  return bare.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Where `word` sits in `sentence`: as written, else ignoring case; whole words before substrings. */
export function findSpan(sentence: string, word: string): [number, number] | null {
  if (!word || !sentence) return null;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const pattern of [`(?<![\\p{L}\\p{M}\\p{N}])${esc}(?![\\p{L}\\p{M}\\p{N}])`, esc])
    for (const flags of ["u", "iu"]) {
      const m = new RegExp(pattern, flags).exec(sentence);
      if (m) return [m.index, m.index + m[0].length];
    }
  return null;
}

// ---------------------------------------------------------------- flashcards

/** A flashcard as the renderer sees it (the scheduler's own state stays in the main process). */
export interface Card {
  id: string;
  lang: string;
  /** The dictionary form; with `lang` it identifies the card, and it is never edited. */
  form: string;
  translation: string;
  definition: string | null;
  createdAt: number;
  suspended: boolean;
  /** Never reviewed yet. */
  isNew: boolean;
  /** When the card is next due, epoch milliseconds. */
  due: number;
}

export type ExampleSourceKind = "article" | "radio" | "tv";

/** A sentence the card's word was met in, and where. */
export interface NewExample {
  sentence: string;
  sentenceTranslation: string | null;
  sourceKind: ExampleSourceKind;
  sourceId: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  /** Character offsets of the phrase within `sentence`. */
  span?: [number, number] | null;
  /** When it was met (epoch ms); defaults to now. */
  at?: number;
  /** Radio and TV: the finished live sentence it is (its row in the live history), whose audio becomes the example's clip. */
  liveSentenceId?: string;
}

export interface NewCard {
  lang: string;
  form: string;
  translation: string;
  definition: string | null;
  example: NewExample;
}

/** Where an example was met, as the window showing it knows it. */
export type ExampleSource = Pick<NewExample, "sourceKind" | "sourceId" | "sourceTitle" | "sourceUrl">;

/**
 * The card a window adds for a word or phrase met in `sentence` (the dictionary popup, the floating
 * window's Save, the right-click menu). An empty translation stays "" (filled in later), an empty
 * definition or sentence translation is null, and `liveSentenceId` (a radio or TV sentence) is left
 * out when there is none.
 */
export function newCardFrom(p: {
  lang: string;
  form: string;
  translation?: string;
  definition?: string | null;
  sentence: string;
  sentenceTranslation?: string | null;
  source: ExampleSource;
  span: [number, number] | null;
  liveSentenceId?: string | null;
}): NewCard {
  return {
    lang: p.lang,
    form: p.form,
    translation: p.translation ?? "",
    definition: p.definition || null,
    example: {
      sentence: p.sentence,
      sentenceTranslation: p.sentenceTranslation || null,
      ...p.source,
      span: p.span,
      ...(p.liveSentenceId && { liveSentenceId: p.liveSentenceId }),
    },
  };
}

/** What adding a card did. `clip` (only for an example from a live sentence): whether its audio was kept. */
export interface AddedCard {
  card: Card;
  created: boolean;
  clip?: "saved" | "unavailable";
}

/** A saved example as the review screen shows it. */
export interface CardExample {
  id: string;
  sentence: string;
  sentenceTranslation: string | null;
  /** The phrase's UTF-16 offsets in `sentence`; null for examples saved before spans were kept. */
  span: [number, number] | null;
  sourceKind: ExampleSourceKind;
  sourceId: string | null;
  sourceTitle: string | null;
  /** Where it came from, as a reader would name it: the outlet ("Le Monde"), the station, else the site's domain. */
  sourceName: string | null;
  sourceUrl: string | null;
  /** When it was met, epoch ms. */
  at: number;
  /** Radio and TV: the sentence's audio, Ogg Opus (null when it has none, or when it was left unloaded). */
  clip: Uint8Array | null;
  /** Whether it has a clip (also when its bytes weren't loaded). */
  hasClip: boolean;
  /** Radio and TV: the sentence in the live history, and the session (the past transcript) it was heard in. */
  liveSentenceId: string | null;
  liveSessionId: string | null;
}

/** What exporting for Anki did: how many cards went, and how many clips are in its media folder. */
export interface CardsExported {
  cards: number;
  media: number;
  file: string;
}

/** A card with every one of its examples (the cards list, and the Anki export). */
export interface CardWithExamples extends Card {
  examples: CardExample[];
}

/** Again, Hard, Good, Easy. */
export type ReviewRating = 1 | 2 | 3 | 4;

/** How long each rating would keep the card away (ms from the moment of the preview), as the scheduler previews it. */
export type IntervalPreview = Record<ReviewRating, number>;

/** What today's study day holds so far (the day turns over at 4 AM). */
export interface ActivityToday {
  reviews: number;
  listenMinutes: number;
}

export interface CardCounts {
  due: number;
  new: number;
  /** When the next card not yet due comes due, if that is before today's study day ends (a card in learning), else null. */
  nextDueToday: number | null;
}

/** Days start at 4 AM, so a late night's reviews still belong to the day before. */
export const DAY_STARTS_AT_HOUR = 4;

/** The calendar day (local midnight) of the study day `now` is in. Local fields, not an hour subtracted from the
 * instant, so a day with 23 or 25 hours (daylight saving) still turns over at 4 AM on the wall clock. */
const studyDate = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getHours() < DAY_STARTS_AT_HOUR ? 1 : 0));

/** The local date ("2026-11-08") of the study day `now` falls in. */
export function studyDay(now: Date): string {
  const d = studyDate(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The instant (epoch ms) the study day `now` falls in began: 4 AM local. */
export function studyDayStart(now: Date): number {
  const d = studyDate(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_STARTS_AT_HOUR).getTime();
}

/** The instant (epoch ms) the next study day begins: 4 AM local. */
export function studyDayEnd(now: Date): number {
  const d = studyDate(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, DAY_STARTS_AT_HOUR).getTime();
}
