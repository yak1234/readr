// Live transcription logic shared by live sources (radio): where to cut
// the audio into segments, and how a recognised segment becomes timed sentences.
//
// The speech recogniser (NeMo-Speech.cpp, Nemotron 3.5) times words from the
// start of each committed segment, so each segment remembers the media time it
// started at. Segments are cut at pauses so words aren't split.

import { wordsToCues, type Cue } from "./captions";
import type { Article } from "./types";

export interface Segmenting {
  minSeconds: number;
  maxSeconds: number;
  /** Loudness (0..1) below which a chunk counts as a pause. */
  quiet: number;
}

const DEFAULTS: Segmenting = { minSeconds: 6, maxSeconds: 15, quiet: 0.02 };
const RATE = 16000;
/** A media-time jump bigger than this (ad, seek, pause) closes the segment. */
const JUMP = 1;

export class Segmenter {
  private opts: Segmenting;
  private begin: number | null = null;
  private length = 0; // seconds of audio in the current segment

  constructor(opts: Partial<Segmenting> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Media time at which the current segment started. */
  get start(): number {
    return this.begin ?? 0;
  }

  /** Call for each chunk before sending it. True means: commit the current
   * segment first; this chunk starts the next one. */
  push(samples: number, chunkLevel: number, mediaTime: number): boolean {
    const seconds = samples / RATE;
    if (this.begin === null) {
      this.begin = mediaTime;
      this.length = seconds;
      return false;
    }
    const jumped = Math.abs(mediaTime - (this.begin + this.length)) > JUMP;
    const full = this.length >= this.opts.maxSeconds;
    const pause = this.length >= this.opts.minSeconds && chunkLevel < this.opts.quiet;
    if (jumped || full || pause) {
      this.begin = mediaTime;
      this.length = seconds;
      return true;
    }
    this.length += seconds;
    return false;
  }
}

export interface FinalWord {
  word: string;
  start: number; // seconds from the segment start
  end: number;
}

export interface Final {
  text: string;
  words: FinalWord[];
}

/** Strips the recogniser's `<unk>` tokens; null when nothing worth translating is left
 * (empty, or at least half the words were unknown). */
export function cleanFinal(f: Final): Final | null {
  const bad = f.words.filter((x) => x.word.includes("<unk>")).length;
  const words = f.words.map((x) => ({ ...x, word: x.word.replace(/<unk>/g, "").trim() })).filter((x) => x.word);
  if (words.length === 0 || bad * 2 >= f.words.length) return null;
  return { text: words.map((x) => x.word).join(" "), words };
}

export function finalToCues(words: FinalWord[], segmentStart: number, lang: string): Cue[] {
  return wordsToCues(
    words.map((w) => ({ text: ` ${w.word}`, start: segmentStart + w.start })),
    lang,
  );
}

/** Where a segment's audio lies in the session's stream, counted in samples (16 kHz) from its start. */
export interface SampleSpan {
  startSample: number;
  endSample: number;
}

/** Pairs each commit with its segment's start time, its samples (when counted) and its
 * transcript (if any: a silent segment gets none). The recogniser answers in order,
 * sending the transcript just before the commit acknowledgement. */
export function segmentQueue() {
  const segments: { start: number; samples: SampleSpan | null }[] = [];
  let pending: Final | null = null;
  return {
    committing(start: number, samples: SampleSpan | null = null) {
      segments.push({ start, samples });
    },
    final(f: Final) {
      pending = f;
    },
    committed(): { start: number; samples: SampleSpan | null; final: Final | null } | null {
      const segment = segments.shift();
      if (segment === undefined) return null;
      const final = pending;
      pending = null;
      return { ...segment, final };
    },
  };
}

/**
 * One recogniser connection's segments: where each ends (Segmenter), and the media time, samples and
 * transcript each committed one has (segmentQueue). Samples are numbered by the caller (the clip
 * buffer), so a segment's span finds its audio.
 */
export class LiveSegments {
  private readonly segmenter: Segmenter;
  private readonly queue = segmentQueue();

  /** `firstSample`: the number of the first sample this connection will send. */
  constructor(
    private startSample: number,
    opts: Partial<Segmenting> = {},
  ) {
    this.segmenter = new Segmenter(opts);
  }

  /** Call for each chunk before sending it; `at` is the number of its first sample. True means: commit
   * the current segment first (it ends where this chunk starts); this chunk starts the next one. */
  push(samples: number, chunkLevel: number, mediaTime: number, at: number): boolean {
    const start = this.segmenter.start;
    if (!this.segmenter.push(samples, chunkLevel, mediaTime)) return false;
    this.queue.committing(start, { startSample: this.startSample, endSample: at });
    this.startSample = at;
    return true;
  }

  final(f: Final): void {
    this.queue.final(f);
  }

  committed() {
    return this.queue.committed();
  }
}

/** What a live transcript keeps. */
export interface WindowOptions {
  /** Paragraphs that ended longer ago than this (before the newest cue) are dropped; 0 keeps everything. */
  windowSeconds: number;
  /** Sentences worth keeping whatever their age (a card was made from them): their paragraph stays. */
  keep?: (sentence: string) => boolean;
}

export const DEFAULT_WINDOW: WindowOptions = { windowSeconds: 3600 };

/** Drops the paragraphs that fell out of the time window. The newest one always stays. */
export function trimLive(article: Article, opts: WindowOptions): Article {
  const times = article.cues ?? [];
  if (opts.windowSeconds <= 0 || article.blocks.length < 2 || times.length !== article.blocks.length) return article;
  const lastEnd = (t: [number, number][]) => (t.length ? t[t.length - 1][1] : -Infinity);
  const newest = Math.max(...times.map(lastEnd));
  const cutoff = newest - opts.windowSeconds;
  const last = article.blocks.length - 1;
  const kept = article.blocks.map((b, i) => i === last || lastEnd(times[i]) >= cutoff || (opts.keep !== undefined && b.sentences.some(opts.keep)));
  if (kept.every(Boolean)) return article;
  const trimmed = { ...article, blocks: article.blocks.filter((_, i) => kept[i]), cues: times.filter((_, i) => kept[i]) };
  return article.liveIds ? { ...trimmed, liveIds: article.liveIds.filter((_, i) => kept[i]) } : trimmed;
}

/** A finished live sentence: its text, when it was spoken, and (once it is in the live history) its id. */
export type LiveCue = Cue & { id?: string };

/** Adds one recognised segment to a live article as a new paragraph. */
export function appendCues(article: Article, cues: LiveCue[], opts: WindowOptions = DEFAULT_WINDOW): Article {
  if (cues.length === 0) return article;
  const blocks = [...article.blocks, { type: "p" as const, sentences: cues.map((c) => c.text) }];
  const times = [...(article.cues ?? []), cues.map((c): [number, number] => [c.start, c.end])];
  const next = { ...article, blocks, cues: times };
  // Ids are kept parallel to the sentences once any arrive ("" for a sentence without one).
  if (article.liveIds || cues.some((c) => c.id)) {
    const before = article.liveIds ?? article.blocks.map((b) => b.sentences.map(() => ""));
    next.liveIds = [...before, cues.map((c) => c.id ?? "")];
  }
  return trimLive(next, opts);
}

/** The live-history id of the sentence drawn with `sentenceKey` ("block:sentence", or the TV
 * subtitle, which shows the newest sentence); undefined when it has none. */
export function liveSentenceIdAt(article: Article, sentenceKey: string): string | undefined {
  const ids = article.liveIds;
  if (!ids) return undefined;
  if (sentenceKey === "tv-subtitle") return ids.at(-1)?.at(-1) || undefined;
  const m = /^(\d+):(\d+)$/.exec(sentenceKey);
  return (m && ids[Number(m[1])]?.[Number(m[2])]) || undefined;
}

/** The end of the words being heard, cut at a word, for the player's live caption. */
export function liveCaption(partial: string, max = 90): string {
  const text = partial.trim();
  if (text.length <= max) return text;
  const tail = text.slice(-(max - 1));
  return `…${tail.slice(tail.indexOf(" ") + 1)}`;
}

/** The words to show as the transcript's last, faded paragraph: what is being
 * heard, unless it only repeats the sentence that was just finalised. */
export function previewParagraph(partial: string, lastFinal?: string): string {
  const squash = (s: string) => s.trim().replace(/\s+/g, " ");
  const text = squash(partial);
  if (!text || (lastFinal !== undefined && text === squash(lastFinal))) return "";
  return text;
}
