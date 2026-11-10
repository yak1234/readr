// The live history: what was heard on radio and TV, kept 30 days. A session is one listening of a
// station or channel; its sentences are the finished sentences of its transcript. Sentences a
// flashcard was made from are kept for as long as the card's example names them.

import crypto from "node:crypto";
import { sql, type Kysely } from "kysely";
import { withTx, type DB } from "./db";
import type { LiveKind, LiveSentence, LiveSession } from "../shared/live-history";

type Db = Kysely<DB>;

/** How long a live transcript is kept. */
export const KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type { LiveKind };
export type LiveSessionStart = Pick<LiveSession, "kind" | "stationId" | "stationName" | "lang">;

/** Starts a session; returns its id. */
export async function startSession(db: Db, s: LiveSessionStart, now: Date): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insertInto("live_sessions")
    .values({ id, kind: s.kind, station_id: s.stationId, station_name: s.stationName, lang: s.lang, started_at: now.getTime(), ended_at: null, target: null })
    .execute();
  return id;
}

/** Saves one segment's finished sentences (in one transaction); returns their ids, in order. */
export function addSentences(db: Db, sessionId: string, cues: { text: string; start: number }[]): Promise<string[]> {
  if (cues.length === 0) return Promise.resolve([]);
  return withTx(db, async (trx) => {
    const rows = cues.map((c) => ({ id: crypto.randomUUID(), session_id: sessionId, t: c.start, text: c.text, translation: null }));
    await trx.insertInto("live_sentences").values(rows).execute();
    return rows.map((r) => r.id);
  });
}

/** Ends a session; returns how long it lasted (ms), or null when there was no open session to end.
 * Runs in the caller's transaction when given one. */
export async function endSession(db: Db, id: string, now: Date): Promise<number | null> {
  const ended = await db
    .updateTable("live_sessions")
    .set({ ended_at: now.getTime() })
    .where("id", "=", id)
    .where("ended_at", "is", null)
    .returning("started_at")
    .executeTakeFirst();
  return ended ? Math.max(0, now.getTime() - ended.started_at) : null;
}

const sessionOf = (r: { id: string; kind: string; station_id: string | null; station_name: string | null; lang: string; started_at: number; ended_at: number | null; target: string | null }): LiveSession => ({
  id: r.id,
  kind: r.kind === "tv" ? "tv" : "radio",
  stationId: r.station_id,
  stationName: r.station_name,
  lang: r.lang,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  target: r.target,
});

/** A station's or channel's sessions, newest first. A station is named by its id, and also by its
 * stream's address when it was listened to before it was saved: pass both. */
export async function listSessions(db: Db, stationIds: readonly string[]): Promise<LiveSession[]> {
  if (stationIds.length === 0) return [];
  const rows = await db.selectFrom("live_sessions").selectAll().where("station_id", "in", stationIds).orderBy("started_at", "desc").execute();
  return rows.map(sessionOf);
}

/** One session, or null when there is none (it was pruned). */
export async function getSession(db: Db, id: string): Promise<LiveSession | null> {
  const row = await db.selectFrom("live_sessions").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? sessionOf(row) : null;
}

/**
 * Ends the sessions a crash (or a forced quit) left open: at their last sentence's time, else when
 * they started. Run once at startup, before any session can start. Returns how many were ended.
 */
export async function closeDangling(db: Db): Promise<number> {
  const r = await db
    .updateTable("live_sessions")
    .set({
      ended_at: sql<number>`started_at + coalesce((select cast(round(1000 * max(t)) as integer) from live_sentences where live_sentences.session_id = live_sessions.id), 0)`,
    })
    .where("ended_at", "is", null)
    .executeTakeFirst();
  return Number(r.numUpdatedRows);
}

/**
 * Keeps translations of a session's sentences (text to translation) in its target language: the
 * first language it is given, set here; translations into any other language aren't kept, and a
 * kept translation is never replaced. One transaction.
 */
export function saveTranslations(db: Db, sessionId: string, target: string, map: Record<string, string>): Promise<void> {
  return withTx(db, async (trx) => {
    const s = await trx.selectFrom("live_sessions").select("target").where("id", "=", sessionId).executeTakeFirst();
    if (!s || (s.target !== null && s.target !== target)) return;
    if (s.target === null) await trx.updateTable("live_sessions").set({ target }).where("id", "=", sessionId).execute();
    for (const [text, translation] of Object.entries(map)) {
      if (!translation.trim()) continue;
      await trx.updateTable("live_sentences").set({ translation }).where("session_id", "=", sessionId).where("text", "=", text).where("translation", "is", null).execute();
    }
  });
}

/** A session's sentences in the order they were spoken. */
export function sessionSentences(db: Db, id: string): Promise<LiveSentence[]> {
  return db.selectFrom("live_sentences").select(["id", "t", "text", "translation"]).where("session_id", "=", id).orderBy("t").orderBy(sql`rowid`).execute();
}

/**
 * Removes sessions started more than 30 days before `now`. A sentence a card's example names is
 * kept, and so is its session (with only such sentences). Returns how many rows went.
 */
export function prune(db: Db, now: Date): Promise<{ sessions: number; sentences: number }> {
  const cutoff = now.getTime() - KEEP_DAYS * DAY_MS;
  return withTx(db, async (trx) => {
    const sentences = await trx
      .deleteFrom("live_sentences")
      .where("session_id", "in", (eb) => eb.selectFrom("live_sessions").select("id").where("started_at", "<", cutoff))
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom("card_examples").select("card_examples.id").whereRef("card_examples.live_sentence_id", "=", "live_sentences.id"))))
      .executeTakeFirst();
    const sessions = await trx
      .deleteFrom("live_sessions")
      .where("started_at", "<", cutoff)
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom("live_sentences").select("live_sentences.id").whereRef("live_sentences.session_id", "=", "live_sessions.id"))))
      .executeTakeFirst();
    return { sessions: Number(sessions.numDeletedRows), sentences: Number(sentences.numDeletedRows) };
  });
}
