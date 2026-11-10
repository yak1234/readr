// Selected text → what the right-click menu works on. Add to flashcards needs words within one
// finished sentence (`contextFromRange`); Translate takes any selection with letters, with the
// sentences it touches as context (`translationFromParts`).
//
// Sentences are drawn as elements carrying `data-sentence-key` (and `data-final="false"` while a
// live sentence is still being heard). The pure rules come first; the DOM functions below only read
// the selection and hand its parts to them.

import type { PhraseResult } from "../../shared/types";

/** A selection within one finished sentence: offsets are UTF-16 indexes into `sentence`. */
export interface SelectionContext {
  sentenceKey: string;
  sentence: string;
  start: number;
  end: number;
  text: string;
}

/** One end of a selection: the sentence element it is in (null outside any) and where in its text. */
export interface SentencePoint {
  sentence: { key: string; text: string; final: boolean } | null;
  offset: number;
}

/** What Translate works on: the selected text, and the sentences it touches joined as context. */
export interface TranslationContext {
  text: string;
  context: string;
}

const EDGE = /[\s\p{P}\p{S}]/u;
const LETTER = /\p{L}/u;
const blank = (s: string) => !/\S/.test(s);

/** `text` without whitespace or punctuation at either edge. */
function trimEdges(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && EDGE.test(text[start])) start++;
  while (end > start && EDGE.test(text[end - 1])) end--;
  return text.slice(start, end);
}

/**
 * The selection between two points, trimmed of whitespace and punctuation at both edges ("cause,"
 * → "cause"). Null when it leaves its sentence or crosses into another, when the sentence is still
 * being heard, or when it holds no letter ("2026", "…").
 */
export function contextFromRange(a: SentencePoint, b: SentencePoint): SelectionContext | null {
  const s = a.sentence;
  if (!s || !b.sentence || b.sentence.key !== s.key || !s.final) return null;
  let start = Math.max(0, Math.min(a.offset, b.offset));
  let end = Math.min(s.text.length, Math.max(a.offset, b.offset));
  while (start < end && EDGE.test(s.text[start])) start++; // as trimEdges, keeping the offsets
  while (end > start && EDGE.test(s.text[end - 1])) end--;
  const text = s.text.slice(start, end);
  if (!LETTER.test(text)) return null;
  return { sentenceKey: s.key, sentence: s.text, start, end, text };
}

/**
 * A selection's ends, ordered, with an end that only reaches into whitespace beside the other end's
 * sentence pulled back to that sentence's edge: dragging past the end of a sentence, into the space
 * before the next one or to its very start, still selects within the first. `outside.afterStart` is
 * the text from the end of `start`'s sentence to `end`; `outside.beforeEnd` the text from `start` to
 * the beginning of `end`'s sentence.
 */
export function clampEnds(start: SentencePoint, end: SentencePoint, outside: { afterStart: string; beforeEnd: string }): [SentencePoint, SentencePoint] {
  const a = start.sentence;
  const b = end.sentence;
  if (a && b?.key !== a.key && blank(outside.afterStart)) return [start, { sentence: a, offset: a.text.length }];
  if (b && a?.key !== b.key && blank(outside.beforeEnd)) return [{ sentence: b, offset: 0 }, end];
  return [start, end];
}

/**
 * What Translate works on: the selected part of each sentence it touches, joined (text between the
 * sentences, such as a translation line drawn under each, is left out), with those sentences as
 * context. Null when the selection has no letter or touches no sentence.
 */
export function translationFromParts(selectedParts: string[], sentences: string[]): TranslationContext | null {
  const text = trimEdges(selectedParts.map((p) => p.trim()).filter(Boolean).join(" "));
  return LETTER.test(text) ? { text, context: sentences.join(" ") } : null;
}

// ---------------------------------------------------------------- the DOM

const SENTENCE = "[data-sentence-key]";

function sentenceElement(node: Node): HTMLElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest<HTMLElement>(SENTENCE) ?? null;
}

/** Where (node, offset) falls in its sentence element. */
function pointIn(node: Node, offset: number): SentencePoint {
  const el = sentenceElement(node);
  if (!el) return { sentence: null, offset: 0 };
  const before = document.createRange();
  before.setStart(el, 0);
  before.setEnd(node, offset);
  return {
    sentence: { key: el.dataset.sentenceKey ?? "", text: el.textContent ?? "", final: el.dataset.final !== "false" },
    offset: before.toString().length,
  };
}

/** The text of a copy of `r` with one end moved by `set` (to a sentence element's edge). */
function textBetween(r: Range, set: (part: Range) => void): string {
  const part = r.cloneRange();
  set(part);
  return part.toString();
}

/** The selection's sentence context, or null (see `contextFromRange` and `clampEnds`). */
export function selectionContext(sel: Selection | null): SelectionContext | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const startEl = sentenceElement(r.startContainer);
  const endEl = sentenceElement(r.endContainer);
  const outside = {
    afterStart: startEl && startEl !== endEl ? textBetween(r, (p) => p.setStartAfter(startEl)) : "",
    beforeEnd: endEl && endEl !== startEl ? textBetween(r, (p) => p.setEndBefore(endEl)) : "",
  };
  return contextFromRange(...clampEnds(pointIn(r.startContainer, r.startOffset), pointIn(r.endContainer, r.endOffset), outside));
}

/** What Translate works on for the selection, or null (see `translationFromParts`). */
export function translationContext(sel: Selection | null): TranslationContext | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const touched = [...document.querySelectorAll<HTMLElement>(SENTENCE)].filter((el) => r.intersectsNode(el));
  const selectedPart = (el: HTMLElement) => {
    const part = document.createRange();
    part.selectNodeContents(el);
    if (r.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(r.startContainer, r.startOffset);
    if (r.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(r.endContainer, r.endOffset);
    return part.toString();
  };
  return translationFromParts(touched.map(selectedPart), touched.map((el) => el.textContent ?? ""));
}

/** The sentence element drawn for `key`. */
export function sentenceElementFor(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${SENTENCE}[data-sentence-key="${CSS.escape(key)}"]`);
}

/** A DOM range over characters [start, end) of a sentence element's text. */
export function rangeInSentence(el: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (!started && start <= seen + len) {
      range.setStart(node, start - seen);
      started = true;
    }
    if (started && end <= seen + len) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += len;
  }
  return null;
}

/** What the renderer tells the main process about its selection: its text, and whether it could become a card. */
export interface SelectionState {
  text: string;
  add: boolean;
}

/**
 * Tells the main process about the current selection (debounced on `selectionchange`, and at once on
 * right-click), so the menu can turn Add to flashcards off for a selection that crosses sentences.
 * It is only a hint: the menu is built from its own selection text, and the action checks again.
 * Returns a function that stops watching.
 */
export function reportSelection(report: (state: SelectionState) => void, debounceMs = 150): () => void {
  let timer: number | undefined;
  let last = "";
  const send = () => {
    window.clearTimeout(timer);
    const sel = window.getSelection();
    const state = { text: sel?.toString() ?? "", add: selectionContext(sel) !== null };
    const key = JSON.stringify(state);
    if (key !== last) (last = key), report(state);
  };
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(send, debounceMs);
  };
  document.addEventListener("selectionchange", later);
  document.addEventListener("contextmenu", send, true);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("selectionchange", later);
    document.removeEventListener("contextmenu", send, true);
  };
}

/**
 * What Add to flashcards keys a card on: the phrase the sidecar snapped the selection to, with its
 * dictionary form. Null when the sidecar didn't answer, or answered without a dictionary or a word
 * analysis for the language (a first run still downloading): its form is then only the text as
 * selected, and a card keyed on it ("mis") would be a duplicate of the one its dictionary form
 * ("mettre") makes once they are there.
 */
export function cardPhrase(snap: PhraseResult | null, sentence: string): { span: [number, number]; text: string; form: string; definition: string } | null {
  if (!snap?.ready) return null;
  const span: [number, number] = [snap.start, snap.end];
  const text = sentence.slice(span[0], span[1]);
  return { span, text, form: snap.form || text, definition: snap.definition };
}
