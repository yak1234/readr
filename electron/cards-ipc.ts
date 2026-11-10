// IPC for flashcards. Everything checks who is asking: the floating window may only add a card and
// give it the translation that arrives afterwards (never replacing one).

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { Kysely } from "kysely";
import type { DB } from "./db";
import * as cards from "./cards";
import { exportCards } from "./anki";
import { isObject, isUuid } from "./json-values";
import type { CardsExported, NewCard, ReviewRating } from "../shared/cards";

export interface CardsIpcOptions {
  /** The database once the library is ready, else null. */
  database: () => Promise<Kysely<DB> | null>;
  fromMain: (e: IpcMainInvokeEvent) => boolean;
  fromFloating: (e: IpcMainInvokeEvent) => boolean;
  /** A card was added or changed: tell the main window. */
  changed: () => void;
  /** The audio clip (Opus) of a live sentence, or null when its audio is no longer held. */
  clipFor: (liveSentenceId: string) => Promise<Uint8Array | null>;
  /** Asks where to export the cards for Anki: a folder, or null when the reader cancels. */
  chooseExportFolder: () => Promise<string | null>;
}


const text = (v: unknown) => (typeof v === "string" ? v : "");
const nullable = (v: unknown) => (typeof v === "string" ? v : null);
/** The longest translation or definition kept: a longer one is cut when it arrives with a new card or
 * afterwards (cards:add, cards:fillTranslation), and refused when the reader types it (cards:edit). */
export const MAX_TEXT = 2000;
const limited = (v: string | null) => (v === null ? null : v.slice(0, MAX_TEXT));
const perDay = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

/** A card from the renderer, with every field checked; null when it has no form or sentence. */
export function newCard(raw: unknown): NewCard | null {
  if (!isObject(raw) || !isObject(raw.example)) return null;
  const e = raw.example;
  const form = text(raw.form).trim();
  const sentence = text(e.sentence);
  if (!form || !sentence) return null;
  const kind = e.sourceKind === "radio" || e.sourceKind === "tv" ? e.sourceKind : "article";
  const span = Array.isArray(e.span) && e.span.length === 2 && e.span.every((n) => Number.isInteger(n)) ? ([e.span[0], e.span[1]] as [number, number]) : null;
  // Only a radio or TV example can be a live sentence.
  const liveSentenceId = kind !== "article" && isUuid(e.liveSentenceId) ? e.liveSentenceId : undefined;
  return {
    lang: text(raw.lang),
    form,
    translation: text(raw.translation).slice(0, MAX_TEXT),
    definition: limited(nullable(raw.definition)),
    example: {
      sentence,
      sentenceTranslation: nullable(e.sentenceTranslation),
      sourceKind: kind,
      sourceId: nullable(e.sourceId),
      sourceTitle: nullable(e.sourceTitle),
      sourceUrl: nullable(e.sourceUrl),
      span,
      ...(liveSentenceId && { liveSentenceId }),
    },
  };
}

export function registerCardsIpc(o: CardsIpcOptions): void {
  ipcMain.handle("cards:add", async (e, raw: unknown) => {
    if (!o.fromMain(e) && !o.fromFloating(e)) return null;
    const card = newCard(raw);
    const db = card && (await o.database());
    if (!card || !db) return null;
    // Encoded before the card's transaction: ffmpeg takes a moment, and a failure only means no audio.
    const liveId = card.example.liveSentenceId;
    const clip = liveId ? await o.clipFor(liveId).catch(() => null) : null;
    const added = await cards.addCard(db, card, new Date(), clip);
    o.changed();
    return added;
  });

  ipcMain.handle("cards:fillTranslation", async (e, cardId: unknown, translation: unknown) => {
    if ((!o.fromMain(e) && !o.fromFloating(e)) || typeof cardId !== "string" || typeof translation !== "string") return false;
    const db = await o.database();
    const filled = db ? await cards.fillTranslation(db, cardId, translation.slice(0, MAX_TEXT)) : false;
    if (filled) o.changed();
    return filled;
  });

  /** The database for a call from the main window, else null. */
  const mainDb = async (e: IpcMainInvokeEvent) => (o.fromMain(e) ? o.database() : null);
  const id = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

  ipcMain.handle("cards:due", async (e, lang: unknown, n: unknown) => {
    const db = typeof lang === "string" ? await mainDb(e) : null;
    return db ? cards.dueQueue(db, text(lang), new Date(), perDay(n)) : [];
  });
  ipcMain.handle("cards:counts", async (e, lang: unknown, n: unknown) => {
    const db = typeof lang === "string" ? await mainDb(e) : null;
    return db ? cards.counts(db, text(lang), new Date(), perDay(n)) : { due: 0, new: 0, nextDueToday: null };
  });
  ipcMain.handle("cards:list", async (e, lang: unknown, query: unknown) => {
    const db = typeof lang === "string" ? await mainDb(e) : null;
    return db ? cards.listCards(db, text(lang), typeof query === "string" ? query : undefined) : [];
  });
  /** Null means only "that card no longer exists"; anything that kept the rating from being saved rejects. */
  ipcMain.handle("cards:review", async (e, cardId: unknown, rating: unknown) => {
    if (!o.fromMain(e)) throw new Error("Only Readr's main window can review cards.");
    if (!id(cardId) || !(rating === 1 || rating === 2 || rating === 3 || rating === 4)) throw new Error("Not a card and a rating from 1 to 4.");
    const db = await o.database();
    if (!db) throw new Error("The library isn't available.");
    const done = await cards.review(db, cardId as string, rating as ReviewRating, new Date());
    o.changed();
    return done;
  });
  /** A card's examples for the review screen, each with its clip's bytes (main window only: they can be large). */
  ipcMain.handle("cards:examples", async (e, cardId: unknown) => {
    const db = id(cardId) ? await mainDb(e) : null;
    return db ? cards.cardExamples(db, cardId as string) : [];
  });
  ipcMain.handle("cards:previewIntervals", async (e, cardId: unknown) => {
    const db = id(cardId) ? await mainDb(e) : null;
    return db ? cards.previewIntervals(db, cardId as string, new Date()) : null;
  });
  /** What a language's cards mark as saved where words are shown (forms, and one-word phrases as written). */
  ipcMain.handle("cards:savedSurfaces", async (e, lang: unknown) => {
    const db = typeof lang === "string" && lang ? await mainDb(e) : null;
    return db ? cards.savedSurfaces(db, lang as string) : [];
  });
  /** The sentences heard on radio or TV that cards were made from (the live transcript keeps their paragraphs). */
  ipcMain.handle("cards:liveSentences", async (e) => {
    const db = await mainDb(e);
    return db ? cards.liveExampleSentences(db) : [];
  });
  /** Exports a language's cards, with their clips, to a folder the reader picks. Null when cancelled. */
  ipcMain.handle("cards:export", async (e, lang: unknown): Promise<CardsExported | null> => {
    const db = typeof lang === "string" && lang ? await mainDb(e) : null;
    if (!db) return null;
    const dir = await o.chooseExportFolder();
    if (!dir) return null;
    const list = await cards.cardsWithExamples(db, lang as string, { clips: false });
    const { file, media } = await exportCards(list, dir, (e) => cards.clipOf(db, e.id));
    return { cards: list.length, media, file };
  });
  ipcMain.handle("cards:suspend", async (e, cardId: unknown, on: unknown) => {
    const db = id(cardId) ? await mainDb(e) : null;
    if (!db) return;
    await cards.setSuspended(db, cardId as string, on === true);
    o.changed();
  });
  ipcMain.handle("cards:delete", async (e, cardId: unknown) => {
    const db = id(cardId) ? await mainDb(e) : null;
    if (!db) return;
    await cards.deleteCard(db, cardId as string);
    o.changed();
  });
  /** Rejects (and changes nothing) when it can't be saved, so the cards list can say so. */
  ipcMain.handle("cards:edit", async (e, cardId: unknown, patch: unknown) => {
    if (!o.fromMain(e)) throw new Error("Only Readr's main window can edit cards.");
    if (!id(cardId) || !isObject(patch)) throw new Error("Not a card and an edit.");
    const translation = typeof patch.translation === "string" ? patch.translation : undefined;
    const definition = typeof patch.definition === "string" || patch.definition === null ? patch.definition : undefined;
    if ((translation?.length ?? 0) > MAX_TEXT || (definition?.length ?? 0) > MAX_TEXT) throw new Error(`Longer than ${MAX_TEXT} characters.`);
    const db = await o.database();
    if (!db) throw new Error("The library isn't available.");
    await cards.editCard(db, cardId as string, { ...(translation !== undefined && { translation }), ...(definition !== undefined && { definition }) });
    o.changed();
  });
}
