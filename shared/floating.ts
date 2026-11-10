// Pure helpers for the floating (always-on-top) radio window.

import type { Article, Block, FloatingState, Lang, LookupResult } from "./types";
import { DEFAULT_LANG } from "./languages";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Size = Pick<Rect, "width" | "height">;

export const FLOATING_DEFAULT: Size = { width: 420, height: 220 };
export const FLOATING_MIN: Size = { width: 320, height: 140 };

/** The newest n sentences across paragraph boundaries, oldest first.
 * Keys are "block:sentence", as in the transcript; `liveIds` (parallel to the sentences) adds each one's live-history id. */
export function lastSentences(blocks: Block[], n: number, liveIds?: string[][]): { key: string; text: string; liveId?: string }[] {
  const out: { key: string; text: string; liveId?: string }[] = [];
  for (let b = blocks.length - 1; b >= 0 && out.length < n; b--) {
    for (let s = blocks[b].sentences.length - 1; s >= 0 && out.length < n; s--) {
      const liveId = liveIds?.[b]?.[s];
      out.unshift({ key: `${b}:${s}`, text: blocks[b].sentences[s], ...(liveId && { liveId }) });
    }
  }
  return out;
}

/** What to do to the main window. */
export type MainWindowAction = "minimize" | "restore" | "show" | "focus";

/** Opening the floating player gets Readr out of the way. A fullscreen window is left alone
 * (macOS would only slide it to another Space), as is one already minimised. */
export function onFloatingOpened(main: { minimized: boolean; fullScreen: boolean }): MainWindowAction[] {
  return main.minimized || main.fullScreen ? [] : ["minimize"];
}

/** A title (or a word) clicked in the floating player brings Readr back to the front. */
export function onFloatingBringBack(main: { minimized: boolean }): MainWindowAction[] {
  return main.minimized ? ["restore", "show", "focus"] : ["show", "focus"];
}

const between = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** A saved window position made safe to restore: never smaller than the
 * minimum, and moved fully onto a visible display when its centre is off every
 * display (a monitor was unplugged). With no saved position, only the size. */
export function clampBounds(saved: (Size & Partial<Rect>) | null | undefined, displays: Rect[]): Size & Partial<Rect> {
  const width = Math.max(FLOATING_MIN.width, saved?.width ?? FLOATING_DEFAULT.width);
  const height = Math.max(FLOATING_MIN.height, saved?.height ?? FLOATING_DEFAULT.height);
  if (!saved || saved.x === undefined || saved.y === undefined || displays.length === 0) return { width, height };
  const cx = saved.x + width / 2;
  const cy = saved.y + height / 2;
  const inside = (d: Rect) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height;
  if (displays.some(inside)) return { x: saved.x, y: saved.y, width, height };
  const gap = (d: Rect) => Math.hypot(cx - between(cx, d.x, d.x + d.width), cy - between(cy, d.y, d.y + d.height));
  const d = displays.reduce((a, b) => (gap(b) < gap(a) ? b : a));
  const w = Math.min(width, d.width);
  const h = Math.min(height, d.height);
  return { x: between(saved.x, d.x, d.x + d.width - w), y: between(saved.y, d.y, d.y + d.height - h), width: w, height: h };
}

/** The one-line gloss for the tooltip (and what Save stores): the word in the
 * station's target language when known, else the dictionary, else the machine gloss. */
export function pickGloss(r: LookupResult | null): string {
  if (!r) return "";
  return r.gloss_target || r.senses[0]?.glosses[0] || r.mtGloss || "";
}

const norm = (w: string) => w.toLowerCase().replace(/’/g, "'").replace(/['’]$/, "");

/** The forms of the cards made, normalised for matching. */
export function savedWords(forms: string[]): string[] {
  return [...new Set(forms.filter(Boolean).map(norm))];
}

export function wordIsSaved(saved: string[] | Set<string>, word: string): boolean {
  return (saved instanceof Set ? saved : new Set(saved)).has(norm(word));
}

/** The live session (a radio station or a TV channel), as far as "what is playing" needs it. */
export interface NowPlayingRadio {
  article: Article | null;
  playing: boolean;
  failed: boolean;
}

/** A read-aloud session: the article, where it is, and its sentences (keys as "block:sentence"). */
export interface NowPlayingReader {
  /** The session is open (its bar is showing), playing or paused. */
  active: boolean;
  article: { id: string; title: string; source: string; language: Lang; url: string } | null;
  playing: boolean;
  index: number;
  keys: string[];
  sentences: string[];
}

/** What the floating window is told about whatever is playing. */
export interface NowPlaying {
  kind: "radio" | "tv" | "article";
  /** The article's, station's or channel's id. */
  id: string;
  title: string;
  source: string;
  language: Lang;
  url: string;
  playing: boolean;
  failed: boolean;
  /** Radio: the newest finished sentences. Article: the sentence being read, then the next few. */
  sentences: { key: string; text: string }[];
  /** Article only: the sentence being read (0-based) and how many there are. */
  index?: number;
  total?: number;
}

/** Sentences the floating window keeps in view for a radio station / for read-aloud. */
export const RADIO_SENTENCES = 4;
export const ARTICLE_SENTENCES = 4;

/** What is playing now, or null for nothing. Read-aloud, radio and TV never play at
 * once (starting one stops the others), so an open read-aloud session was started
 * after the station or channel last played and owns the window; else that does. */
export function nowPlaying(radio: NowPlayingRadio, reader: NowPlayingReader): NowPlaying | null {
  if (reader.active && reader.article) {
    const from = Math.max(0, Math.min(reader.index, reader.sentences.length - 1));
    const sentences = reader.sentences.slice(from, from + ARTICLE_SENTENCES).map((text, i) => ({ key: reader.keys[from + i], text }));
    return { kind: "article", id: reader.article.id, title: reader.article.title, source: reader.article.source, language: reader.article.language, url: reader.article.url, playing: reader.playing, failed: false, sentences, index: reader.index, total: reader.sentences.length };
  }
  if (radio.article) {
    const a = radio.article;
    return { kind: a.kind === "tv" ? "tv" : "radio", id: a.id, title: a.title, source: a.source, language: a.language, url: a.url, playing: radio.playing, failed: radio.failed, sentences: lastSentences(a.blocks, RADIO_SENTENCES, a.liveIds) };
  }
  return null;
}

/** The part of the floating snapshot that says what is playing (the rest is
 * translations, the saved words and the theme). Nothing playing is `kind: null`. */
export function playingFields(np: NowPlaying | null, target: string): Pick<FloatingState, "kind" | "id" | "title" | "source" | "language" | "url" | "target" | "playing" | "failed" | "sentences" | "index" | "total"> {
  if (!np) return { kind: null, id: "", title: "", source: "", language: DEFAULT_LANG, url: "", target, playing: false, failed: false, sentences: [] };
  return { kind: np.kind, id: np.id, title: np.title, source: np.source, language: np.language, url: np.url, target, playing: np.playing, failed: np.failed, sentences: np.sentences, index: np.index, total: np.total };
}
