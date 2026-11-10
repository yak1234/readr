// Flashcards: the only place card rows are written. Scheduling is ts-fsrs's; every function
// takes the database and the time, so a test can run a whole month on a fixed clock.

import crypto from "node:crypto";
import { sql, type Kysely } from "kysely";
import { DefaultScheduler, type DefaultSchedulerCard } from "ts-fsrs";
import { getDomain } from "tldts";
import { withTx, type DB } from "./db";
import * as activity from "./activity";
import type { CardsTable, ExampleSourceKind } from "./db/schema";
import { findSpan, normKey, studyDayEnd, studyDayStart, type AddedCard, type Card, type CardCounts, type CardExample, type CardWithExamples, type IntervalPreview, type NewCard, type NewExample, type ReviewRating } from "../shared/cards";
import { languageForText } from "../shared/languages";
import type { VocabEntry } from "../shared/types";

type Db = Kysely<DB>;

/** ts-fsrs's current scheduler (FSRS-7) with its default parameters and fuzzing on. Created once, on first use.
 * ts-fsrs 6's DefaultScheduler resolves asynchronously: this is the promise of it, which callers await. */
let scheduler: ReturnType<typeof DefaultScheduler> | undefined;
const getScheduler = () => (scheduler ??= DefaultScheduler({ enableFuzz: true }));
type FsrsCard = DefaultSchedulerCard;

/** A card as stored (`fsrs_json`) back to what the scheduler takes: its dates are strings in JSON. */
function loadCard(json: string, id: string): FsrsCard {
  const raw = JSON.parse(json);
  if (typeof raw.stabilityFast !== "number")
    throw new Error(`Card ${id} still holds a pre-FSRS-7 memory state, which can't be rescheduled (see migration 0004).`);
  return { ...raw, dueAt: new Date(raw.dueAt), lastReviewAt: raw.lastReviewAt ? new Date(raw.lastReviewAt) : null };
}

const cardOf = (r: Pick<CardsTable, "id" | "lang" | "form" | "translation" | "definition" | "created_at" | "suspended" | "is_new" | "due">): Card => ({
  id: r.id,
  lang: r.lang,
  form: r.form,
  translation: r.translation,
  definition: r.definition,
  createdAt: r.created_at,
  suspended: r.suspended === 1,
  isNew: r.is_new === 1,
  due: r.due,
});

const CARD_COLUMNS = ["id", "lang", "form", "translation", "definition", "created_at", "suspended", "is_new", "due"] as const;

/** Runs `fn` in the open transaction `db` is, else in a new one. */
const inTx = <T>(db: Db, fn: (trx: Db) => Promise<T>): Promise<T> => (db.isTransaction ? fn(db) : withTx(db, fn));

// ---------------------------------------------------------------- adding

/** The language most saved articles are in, if any: a last resort for a card's language. */
export async function commonestArticleLang(db: Db): Promise<string | undefined> {
  const top = await db
    .selectFrom("articles")
    .select(["lang", (eb) => eb.fn.countAll<number>().as("n")])
    .where("lang", "!=", "")
    .groupBy("lang")
    .orderBy("n", "desc")
    .executeTakeFirst();
  return top?.lang;
}

/**
 * A card's language: `inferred`, unless the form's script can't be written in it (then the
 * script's language). Never empty: with nothing inferred and a shared script (Latin), the
 * library's commonest language, else "und".
 */
export async function cardLanguage(form: string, inferred: string, commonest: () => Promise<string | undefined> | string | undefined): Promise<string> {
  return languageForText(form, inferred) || (await commonest()) || "und";
}

/** The card for (lang, form), made fresh if it doesn't exist. A fresh card is new and due from the start of today's study day. */
async function ensureCard(
  trx: Db,
  c: { lang: string; form: string; translation: string; definition: string | null },
  createdAt: number,
  now: Date,
): Promise<{ card: Card; created: boolean }> {
  const key = normKey(c.form);
  const found = await trx.selectFrom("cards").select(CARD_COLUMNS).where("lang", "=", c.lang).where("form_key", "=", key).executeTakeFirst();
  if (found) {
    const fill = {
      ...(!found.translation && c.translation && { translation: c.translation }),
      ...(!found.definition && c.definition && { definition: c.definition }),
    };
    if (Object.keys(fill).length) await trx.updateTable("cards").set(fill).where("id", "=", found.id).execute();
    return { card: cardOf({ ...found, ...fill }), created: false };
  }
  const id = crypto.randomUUID();
  const row = {
    id,
    lang: c.lang,
    form: c.form,
    form_key: key,
    translation: c.translation,
    definition: c.definition,
    created_at: createdAt,
    suspended: 0,
    fsrs_json: JSON.stringify((await getScheduler()).newCard({ now: new Date(createdAt), cardId: id })),
    due: studyDayStart(now),
    is_new: 1,
  };
  await trx.insertInto("cards").values(row).execute();
  return { card: cardOf(row), created: true };
}

/** `span` if it lies within `sentence` (0 <= start <= end <= length), else null. */
const validSpan = (span: NewExample["span"], sentence: string): [number, number] | null =>
  span && Number.isInteger(span[0]) && Number.isInteger(span[1]) && span[0] >= 0 && span[0] <= span[1] && span[1] <= sentence.length ? span : null;

/** An example's live sentence and clip: kept only when the sentence is in the live history (an id naming
 * nothing would never be protected from pruning), and the clip only with its sentence. */
async function liveSource(trx: Db, liveSentenceId: string | undefined, clip: Uint8Array | null): Promise<{ id: string | null; clip: Uint8Array | null }> {
  if (!liveSentenceId) return { id: null, clip: null };
  const found = await trx.selectFrom("live_sentences").select("id").where("id", "=", liveSentenceId).executeTakeFirst();
  return found ? { id: found.id, clip } : { id: null, clip: null };
}

async function insertExample(trx: Db, cardId: string, id: string, e: NewExample & { at: number }, clip: Uint8Array | null = null): Promise<"saved" | "unavailable" | undefined> {
  const span = validSpan(e.span, e.sentence);
  const live = await liveSource(trx, e.liveSentenceId, clip);
  await trx
    .insertInto("card_examples")
    .values({
      id,
      card_id: cardId,
      sentence: e.sentence,
      sentence_translation: e.sentenceTranslation,
      source_kind: e.sourceKind,
      source_id: e.sourceId,
      source_title: e.sourceTitle,
      source_url: e.sourceUrl,
      at: e.at,
      span_start: span?.[0] ?? null,
      span_end: span?.[1] ?? null,
      live_sentence_id: live.id,
      clip: live.clip,
    })
    .execute();
  return e.liveSentenceId ? (live.clip ? "saved" : "unavailable") : undefined;
}

/**
 * Makes a card, or, when (lang, normalised form) already has one, adds the sentence to it as another
 * example. The language is corrected by the form's script and is never empty. An example from a live
 * sentence keeps `clip` (its audio, Opus); the result says whether it has one.
 */
export function addCard(db: Db, input: NewCard, now: Date, clip: Uint8Array | null = null): Promise<AddedCard> {
  return inTx(db, async (trx) => {
    const lang = await cardLanguage(input.form, input.lang, () => commonestArticleLang(trx));
    const result = await ensureCard(trx, { ...input, lang }, now.getTime(), now);
    const saved = await insertExample(trx, result.card.id, crypto.randomUUID(), { ...input.example, at: input.example.at ?? now.getTime() }, clip);
    return saved ? { ...result, clip: saved } : result;
  });
}

/** A saved word's dictionary form, which makes its card: the lemma, else the word as clicked. */
export const legacyForm = (v: Pick<VocabEntry, "word" | "lemma">): string => (typeof v.lemma === "string" && v.lemma.trim()) || String(v.word ?? "").trim();

/**
 * Writes one saved word (the old vocabulary shape) as a card example, in language `lang`. Words
 * with the same language and normalised dictionary form share one card; each entry becomes its own
 * example, keeping the entry's id when it has a usable one. A new card is created at the entry's
 * `addedAt`. Returns the example's id. Runs in the caller's transaction when it is in one.
 */
export function addCardFromLegacy(
  db: Db,
  v: VocabEntry,
  lang: string,
  where: { kind: ExampleSourceKind; sourceId: string | null; now: Date },
): Promise<string> {
  return inTx(db, async (trx) => {
    const parsed = Date.parse(v.addedAt);
    const at = Number.isFinite(parsed) ? parsed : where.now.getTime();
    const gloss = typeof v.gloss === "string" ? v.gloss : "";
    const { card } = await ensureCard(trx, { lang, form: legacyForm(v), translation: gloss, definition: null }, at, where.now);
    const sentence = typeof v.sentence === "string" ? v.sentence : "";
    // The entry's own id is kept (so it still names the same saved word) unless it is missing or already used.
    const reuse = typeof v.id === "string" && v.id !== "" && !(await trx.selectFrom("card_examples").select("id").where("id", "=", v.id).executeTakeFirst());
    const id = reuse ? v.id : crypto.randomUUID();
    await insertExample(trx, card.id, id, {
      sentence,
      sentenceTranslation: typeof v.sentenceTranslation === "string" ? v.sentenceTranslation : null,
      sourceKind: where.kind,
      sourceId: where.sourceId,
      sourceTitle: typeof v.articleTitle === "string" ? v.articleTitle : null,
      sourceUrl: typeof v.articleUrl === "string" ? v.articleUrl : null,
      span: findSpan(sentence, v.word),
      at,
    });
    return id;
  });
}

// ---------------------------------------------------------------- studying

/** New cards first met today (their first review is in today's study day): they use up today's allowance. */
async function newIntroducedToday(db: Db, lang: string, now: Date): Promise<number> {
  const start = studyDayStart(now);
  const { rows } = await sql<{ n: number }>`
    select count(distinct r.card_id) as n
    from reviews r join cards c on c.id = r.card_id
    where c.lang = ${lang} and r.reviewed_at >= ${start}
      and not exists (select 1 from reviews p where p.card_id = r.card_id and p.reviewed_at < ${start})`.execute(db);
  return rows[0]?.n ?? 0;
}

const newAllowance = async (db: Db, lang: string, now: Date, newPerDay: number) => Math.max(0, newPerDay - (await newIntroducedToday(db, lang, now)));

/** What to study now: every due review, oldest due first, then today's remaining allowance of new cards, oldest first. */
export async function dueQueue(db: Db, lang: string, now: Date, newPerDay: number): Promise<Card[]> {
  const due = await db
    .selectFrom("cards")
    .select(CARD_COLUMNS)
    .where("lang", "=", lang)
    .where("suspended", "=", 0)
    .where("is_new", "=", 0)
    .where("due", "<=", now.getTime())
    .orderBy("due")
    .orderBy("created_at")
    .execute();
  const room = await newAllowance(db, lang, now, newPerDay);
  const fresh = room
    ? await db.selectFrom("cards").select(CARD_COLUMNS).where("lang", "=", lang).where("suspended", "=", 0).where("is_new", "=", 1).orderBy("created_at").orderBy(sql`rowid`).limit(room).execute()
    : [];
  return [...due, ...fresh].map(cardOf);
}

export async function counts(db: Db, lang: string, now: Date, newPerDay: number): Promise<CardCounts> {
  const count = async (isNew: 0 | 1, limit?: number) => {
    let q = db.selectFrom("cards").select((eb) => eb.fn.countAll<number>().as("n")).where("lang", "=", lang).where("suspended", "=", 0).where("is_new", "=", isNew);
    if (!isNew) q = q.where("due", "<=", now.getTime());
    const n = (await q.executeTakeFirstOrThrow()).n;
    return limit === undefined ? n : Math.min(n, limit);
  };
  const next = await db
    .selectFrom("cards")
    .select((eb) => eb.fn.min<number>("due").as("at"))
    .where("lang", "=", lang)
    .where("suspended", "=", 0)
    .where("is_new", "=", 0)
    .where("due", ">", now.getTime())
    .where("due", "<", studyDayEnd(now))
    .executeTakeFirst();
  return { due: await count(0), new: await count(1, await newAllowance(db, lang, now, newPerDay)), nextDueToday: next?.at ?? null };
}

/** Rates a card: ts-fsrs schedules the next review, and the new state, the review log and today's
 * activity are written together. Null when the card no longer exists (deleted elsewhere). */
export function review(db: Db, cardId: string, rating: ReviewRating, now: Date): Promise<Card | null> {
  return inTx(db, async (trx) => {
    const row = await trx.selectFrom("cards").select([...CARD_COLUMNS, "fsrs_json"]).where("id", "=", cardId).executeTakeFirst();
    if (!row) return null;
    const { card, revlog } = (await getScheduler()).review({ card: loadCard(row.fsrs_json, cardId), grade: rating, now });
    const due = card.dueAt.getTime();
    await trx.updateTable("cards").set({ fsrs_json: JSON.stringify(card), due, is_new: 0 }).where("id", "=", cardId).execute();
    await trx.insertInto("reviews").values({ id: crypto.randomUUID(), card_id: cardId, rating, reviewed_at: now.getTime(), log_json: JSON.stringify(revlog) }).execute();
    await activity.record(trx, "review", cardId, 1, now);
    return cardOf({ ...row, due, is_new: 0 });
  });
}

/** How long each rating would keep the card away (ms) if it were rated at `now`: ts-fsrs's own
 * preview, measured from that same `now`, so the buttons show what rating then does. Null when the
 * card no longer exists. */
export async function previewIntervals(db: Db, cardId: string, now: Date): Promise<IntervalPreview | null> {
  const row = await db.selectFrom("cards").select("fsrs_json").where("id", "=", cardId).executeTakeFirst();
  if (!row) return null;
  const preview = (await getScheduler()).preview({ card: loadCard(row.fsrs_json, cardId), now });
  const wait: Partial<IntervalPreview> = {};
  for (const item of preview) wait[item.grade as ReviewRating] = item.card.dueAt.getTime() - now.getTime();
  return wait as IntervalPreview;
}

/** Examples (of one card, or of a language's cards), the one met most recently first, each with where
 * it came from, the live session it was heard in, and its audio (unless `clips` is false: then only
 * whether it has some). */
async function examplesOf(db: Db, where: { cardId: string } | { lang: string }, clips = true): Promise<(CardExample & { cardId: string })[]> {
  let q = db
    .selectFrom("card_examples as e")
    .leftJoin("articles as a", (join) => join.onRef("a.id", "=", "e.source_id").on("e.source_kind", "=", "article"))
    .leftJoin("live_sentences as ls", "ls.id", "e.live_sentence_id")
    .select([
      "e.id", "e.card_id", "e.sentence", "e.sentence_translation", "e.span_start", "e.span_end", "e.source_kind", "e.source_id",
      "e.source_title", "e.source_url", "e.at", "e.live_sentence_id", "ls.session_id", "a.source as outlet",
      clips ? "e.clip" : sql<Uint8Array | null>`null`.as("clip"),
      sql<number>`e.clip is not null`.as("has_clip"),
    ])
    .orderBy("e.at", "desc")
    .orderBy(sql`e.rowid`, "desc");
  q = "cardId" in where ? q.where("e.card_id", "=", where.cardId) : q.where("e.card_id", "in", (eb) => eb.selectFrom("cards").select("id").where("lang", "=", where.lang));
  const rows = await q.execute();
  return rows.map((r) => ({
    id: r.id,
    cardId: r.card_id,
    sentence: r.sentence,
    sentenceTranslation: r.sentence_translation,
    span: r.span_start !== null && r.span_end !== null ? [r.span_start, r.span_end] : null,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    sourceTitle: r.source_title,
    sourceName: r.source_kind === "article" ? r.outlet || (r.source_url && getDomain(r.source_url)) || null : r.source_title,
    sourceUrl: r.source_url,
    at: r.at,
    clip: r.clip ? new Uint8Array(r.clip) : null,
    hasClip: r.has_clip === 1,
    liveSentenceId: r.live_sentence_id,
    liveSessionId: r.session_id ?? null,
  }));
}

/** A card's examples, the one met most recently first, each with where it came from and its audio. */
export async function cardExamples(db: Db, cardId: string): Promise<CardExample[]> {
  return (await examplesOf(db, { cardId })).map(({ cardId: _, ...e }) => e);
}

/** A language's cards, A to Z, each with all its examples (newest first). Two queries, whatever the count.
 * `clips: false` leaves the clips' bytes in the database (`hasClip` says which have one; see clipOf). */
export async function cardsWithExamples(db: Db, lang: string, opts: { clips?: boolean } = {}): Promise<CardWithExamples[]> {
  const [list, examples] = await Promise.all([listCards(db, lang), examplesOf(db, { lang }, opts.clips ?? true)]);
  const byCard = new Map<string, CardExample[]>();
  for (const { cardId, ...e } of examples) {
    const found = byCard.get(cardId);
    if (found) found.push(e);
    else byCard.set(cardId, [e]);
  }
  return list.map((c) => ({ ...c, examples: byCard.get(c.id) ?? [] }));
}

/** One example's clip, or null. */
export async function clipOf(db: Db, exampleId: string): Promise<Uint8Array | null> {
  const row = await db.selectFrom("card_examples").select("clip").where("id", "=", exampleId).executeTakeFirst();
  return row?.clip ? new Uint8Array(row.clip) : null;
}

/**
 * What a language's cards mark as saved where the words are shown: each card's form, and each
 * example's phrase as it was written when it is one word ("mange" for manger, "المفاوضات" for
 * مفاوضات), lowercased, without repeats.
 */
export async function savedSurfaces(db: Db, lang: string): Promise<string[]> {
  const forms = await db.selectFrom("cards").select("form").where("lang", "=", lang).execute();
  const spans = await db
    .selectFrom("card_examples as e")
    .innerJoin("cards as c", "c.id", "e.card_id")
    .select(["e.sentence", "e.span_start", "e.span_end"])
    .where("c.lang", "=", lang)
    .where("e.span_start", "is not", null)
    .execute();
  const out = new Set(forms.map((f) => f.form.toLowerCase()));
  for (const e of spans) {
    const word = e.sentence.slice(e.span_start!, e.span_end!).trim();
    if (word && !/\s/.test(word)) out.add(word.toLowerCase());
  }
  return [...out];
}

/** The sentences heard on radio or TV that a card was made from: the live transcript keeps their paragraphs. */
export async function liveExampleSentences(db: Db): Promise<string[]> {
  const rows = await db.selectFrom("card_examples").select("sentence").distinct().where("source_kind", "in", ["radio", "tv"]).execute();
  return rows.map((r) => r.sentence);
}

// ---------------------------------------------------------------- managing

const likePattern = (s: string) => `%${s.replace(/[\\%_]/g, "\\$&")}%`;

/** A language's cards, A to Z; `query` keeps those whose form or translation contains it. */
export async function listCards(db: Db, lang: string, query?: string): Promise<Card[]> {
  let q = db.selectFrom("cards").select(CARD_COLUMNS).where("lang", "=", lang).orderBy("form_key");
  const text = query?.trim();
  if (text)
    q = q.where((eb) =>
      eb.or([
        eb(sql`form_key`, "like", likePattern(normKey(text))).$castTo<boolean>(),
        eb(sql`lower(translation)`, "like", likePattern(text.toLowerCase())).$castTo<boolean>(),
      ]),
    );
  return (await q.execute()).map(cardOf);
}

export async function setSuspended(db: Db, cardId: string, suspended: boolean): Promise<void> {
  await db.updateTable("cards").set({ suspended: suspended ? 1 : 0 }).where("id", "=", cardId).execute();
}

/** The card, its examples and its review history. */
export async function deleteCard(db: Db, cardId: string): Promise<void> {
  await db.deleteFrom("cards").where("id", "=", cardId).execute(); // examples and reviews cascade
}

/** Only the translation and definition are editable; the form is the card's identity. */
export async function editCard(db: Db, cardId: string, patch: { translation?: string; definition?: string | null }): Promise<void> {
  const set = {
    ...(typeof patch.translation === "string" && { translation: patch.translation }),
    ...(patch.definition !== undefined && { definition: patch.definition }),
  };
  if (Object.keys(set).length) await db.updateTable("cards").set(set).where("id", "=", cardId).execute();
}

/** Sets a card's translation only if it has none yet (a translation that arrives after the card was added;
 * one the reader edited meanwhile is kept). True when it was filled. */
export async function fillTranslation(db: Db, cardId: string, translation: string): Promise<boolean> {
  if (!translation.trim()) return false;
  const r = await db.updateTable("cards").set({ translation }).where("id", "=", cardId).where("translation", "=", "").executeTakeFirst();
  return Number(r.numUpdatedRows) > 0;
}

