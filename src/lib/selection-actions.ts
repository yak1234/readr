// What the right-click menu's Translate and Add to flashcards do in a window. The popup opens at once
// on the selection, then fills in:
//  - Add to flashcards: the selection (words within one finished sentence) is snapped to the dictionary
//    phrase it belongs to ("cause" → "mis en cause"), marked in the text, and added right away as a
//    card for its dictionary form, with its definition and this sentence as the example. Its
//    translation follows in the background and fills the card's empty translation.
//  - Translate: within one sentence, the snapped phrase in that sentence; across sentences, the
//    selected text with the sentences it touches as context.
// Used by the main window and the floating one.

import { useCallback, useEffect, useRef, useState } from "react";
import { newCardFrom, type ExampleSource } from "../../shared/cards";
import type { MenuAction, SelectionTranslation } from "../../shared/types";
import { api } from "./api";
import { cardPhrase, rangeInSentence, reportSelection, selectionContext, sentenceElementFor, translationContext, type SelectionContext } from "./selection";
import en from "../i18n/en.json";

/** Where a card's example comes from: the article, station or channel being shown. */
export interface SelectionActionsInput {
  /** The text's language, and the language translations are in. */
  lang: string;
  tgt: string;
  /** Where the text comes from, or null when nothing is shown. */
  source: ExampleSource | null;
  /** A sentence's translation, when the window has one. */
  sentenceTranslation: (sentence: string) => string;
  /** Radio and TV: the live-history id of the finished sentence drawn with this key, if it has one. */
  liveSentenceId?: (sentenceKey: string) => string | undefined;
  /** The colour the snapped phrase is marked in (the reading style's snapHighlight). */
  highlight: string;
}

export interface SelectionResult {
  action: MenuAction;
  rect: DOMRect;
  /** The text as it is on the page (snapped to its phrase once known), and its dictionary form. */
  text: string;
  form: string;
  definition: string;
  /** The sentence (or sentences, across sentences) the text is in; `span` places it in a single sentence. */
  context: string;
  span: [number, number] | null;
  /** Working: the popup shows a placeholder. Notice: it says why nothing was done. */
  stage: "working" | "done" | "notice";
  notice?: string;
  translation?: SelectionTranslation | "pending";
  /** Add to flashcards: a new card, or this sentence added to the card the form already had. */
  added?: "new" | "appended";
  /** Add to flashcards from a live sentence: whether its audio clip was kept. */
  clip?: "saved" | "unavailable";
}

/** What the popups say when nothing was done, or how a card was added: the chrome's words (en.json "notices"),
 * under stable keys the e2e harnesses read too. */
export const NOTICES = en.notices;

/** What the popup says once a card was added, given what became of its translation. */
export function addedNote(added: "new" | "appended", translation: SelectionTranslation | "pending" | undefined, hasDefinition: boolean): string {
  const done = added === "appended" ? NOTICES.addedAppended : NOTICES.addedNew;
  if (!translation || translation === "pending" || translation.ok) return done;
  if (translation.reason === "unavailable") return hasDefinition ? done : NOTICES.addedNoTranslation;
  if (translation.reason === "empty") return NOTICES.addedEmpty;
  return NOTICES.addedOffline;
}

const HIGHLIGHT = "readr-snap";
const OFFLINE: SelectionTranslation = { ok: false, reason: "offline" };

function mark(range: Range | null) {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  if (range) CSS.highlights.set(HIGHLIGHT, new Highlight(range));
  else CSS.highlights.delete(HIGHLIGHT);
}

/** The snapped phrase replaces the selection on screen. */
function showSnapped(ctx: SelectionContext, span: [number, number]) {
  const el = sentenceElementFor(ctx.sentenceKey);
  const range = el && rangeInSentence(el, span[0], span[1]);
  mark(range);
  if (range) window.getSelection()?.removeAllRanges();
}

export function useSelectionActions(input: SelectionActionsInput): { result: SelectionResult | null; close: () => void } {
  const [result, setResult] = useState<SelectionResult | null>(null);
  const latest = useRef(input);
  latest.current = input;
  const run = useRef(0); // the newest action: an older one's answers are dropped

  useEffect(() => {
    document.documentElement.style.setProperty("--readr-snap", input.highlight);
  }, [input.highlight]);

  useEffect(() => reportSelection((state) => api.selectionState(state)), []);

  useEffect(
    () =>
      api.onMenu(async (action) => {
        const { lang, tgt, source, sentenceTranslation, liveSentenceId } = latest.current;
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
        const id = ++run.current;
        const set = (patch: Partial<SelectionResult>) => id === run.current && setResult((r) => (r ? { ...r, ...patch } : r));
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const ctx = selectionContext(sel);
        const across = ctx ? null : translationContext(sel);
        const raw = ctx?.text ?? across?.text ?? sel.toString().trim();
        // The popup opens at once, on the selection as it is.
        setResult({ action, rect, text: raw, form: raw, definition: "", context: ctx?.sentence ?? across?.context ?? "", span: ctx ? [ctx.start, ctx.end] : null, stage: "working" });

        if (action === "translate") {
          if (!ctx) {
            if (!across) return set({ stage: "notice", notice: NOTICES.noText });
            const translation = await api.translateSelection(lang, tgt, across.text, across.context).catch(() => OFFLINE);
            return set({ stage: "done", translation });
          }
          const snap = await api.phrase(lang, ctx.sentence, ctx.start, ctx.end).catch(() => null);
          if (id !== run.current) return;
          // Without the dictionary, the selection is translated as it is.
          const span: [number, number] = snap ? [snap.start, snap.end] : [ctx.start, ctx.end];
          const text = ctx.sentence.slice(span[0], span[1]);
          showSnapped(ctx, span);
          set({ text, form: snap?.form || text, definition: snap?.definition ?? "", span });
          const translation = await api.translateSelection(lang, tgt, text, ctx.sentence).catch(() => OFFLINE);
          return set({ stage: "done", translation });
        }

        if (!ctx || !source) return set({ stage: "notice", notice: NOTICES.notOneSentence });
        const snap = await api.phrase(lang, ctx.sentence, ctx.start, ctx.end).catch(() => null);
        if (id !== run.current) return;
        // A card is keyed on its dictionary form. With no answer, or an answer made without the dictionary and
        // without the word analysis (a first run still downloading them), there is none yet: no card, rather
        // than one keyed on the text as selected that would duplicate the right one later.
        const phrase = cardPhrase(snap, ctx.sentence);
        if (!phrase) return set({ stage: "notice", notice: NOTICES.dictionaryNotReady });
        const { span, text, form, definition } = phrase;
        showSnapped(ctx, span);
        set({ text, form, definition, span });
        // A live sentence brings its audio: the main process cuts the clip from what it heard.
        const added = await api
          .cardsAdd(newCardFrom({ lang, form, definition, sentence: ctx.sentence, sentenceTranslation: sentenceTranslation(ctx.sentence), source, span, liveSentenceId: liveSentenceId?.(ctx.sentenceKey) }))
          .catch(() => null);
        if (!added) return set({ stage: "notice", notice: NOTICES.notAdded });
        set({ stage: "done", added: added.created ? "new" : "appended", clip: added.clip, translation: "pending" });
        // The card's back: its dictionary form translated in this sentence, filled in when it arrives.
        const translation = await api.translateSelection(lang, tgt, form, ctx.sentence).catch(() => OFFLINE);
        if (translation.ok) await api.cardsFillTranslation(added.card.id, translation.text).catch(() => false);
        set({ translation });
      }),
    [],
  );

  const close = useCallback(() => {
    run.current++;
    mark(null);
    setResult(null);
  }, []);
  return { result, close };
}
