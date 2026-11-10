// The teleprompter beside a TV channel's picture: the newest finished sentence as the current line, a
// couple of earlier ones fading above it, and the words being heard below, kept apart. Each line keeps
// its transcript key ("block:sentence"), so word clicks, the right-click menu and the live history's
// sentence id work on it as they do in the transcript.

import type { Article } from "../../shared/types";
import { previewParagraph } from "../../shared/live-transcript";

/** From this content width (px: the main column, between the side panels) a TV channel shows its picture and
 * the teleprompter side by side. */
export const TELEPROMPTER_FROM = 900;

/** A finished sentence, as the teleprompter is given it. */
export interface TeleprompterCue {
  /** Its key in the transcript ("block:sentence"). */
  key: string;
  text: string;
  /** Its translation, once it has one. */
  translation?: string;
}

export interface TeleprompterLine extends TeleprompterCue {
  /** What identifies the line as it moves up (a React key): its text, and how many times it is repeated after it.
   * Transcript keys renumber when old paragraphs are dropped; this doesn't. */
  id: string;
  /** Lines are finished sentences: the right-click menu may add them. */
  final: true;
  /** 1 for the current line; less the further back a line is. */
  opacity: number;
}

export interface TeleprompterView {
  /** Earlier lines, oldest first. */
  past: TeleprompterLine[];
  current: TeleprompterLine | null;
  /** The words being heard, shown on their own (empty when they only repeat the current line). */
  preview: string;
}

/** The faintest a kept line gets, and how much brighter each step towards the current line is. */
const FAINTEST = 0.2;
const RANGE = 0.6;

/** A line `back` steps before the current one, of `keep` kept: the same step whatever else is shown. */
function fade(back: number, keep: number): number {
  return Math.round((FAINTEST + (RANGE * (keep + 1 - back)) / (keep + 1)) * 100) / 100;
}

/** The lines to show: the newest finished sentence, up to `keep` earlier ones, and the words being heard. */
export function teleprompterLines(cues: readonly TeleprompterCue[], preview: string, keep = 2): TeleprompterView {
  const shown = cues.slice(Math.max(0, cues.length - 1 - Math.max(0, keep)));
  const ids = shown.map((c, i) => `${c.text}#${shown.slice(i + 1).filter((x) => x.text === c.text).length}`);
  const lines = shown.map((c, i): TeleprompterLine => ({ ...c, id: ids[i], final: true, opacity: i === shown.length - 1 ? 1 : fade(shown.length - 1 - i, keep) }));
  const newest = cues.at(-1);
  return { past: lines.slice(0, -1), current: lines.at(-1) ?? null, preview: previewParagraph(preview, newest?.text) };
}

/** The article's last `n` sentences as teleprompter cues, without walking the whole transcript. */
export function newestCues(article: Article, translations: Record<string, string>, n: number): TeleprompterCue[] {
  const out: TeleprompterCue[] = [];
  for (let b = article.blocks.length - 1; b >= 0 && out.length < n; b--) {
    const sentences = article.blocks[b].sentences;
    for (let s = sentences.length - 1; s >= 0 && out.length < n; s--) {
      const text = sentences[s];
      const translation = translations[text];
      out.push(translation === undefined ? { key: `${b}:${s}`, text } : { key: `${b}:${s}`, text, translation });
    }
  }
  return out.reverse();
}
