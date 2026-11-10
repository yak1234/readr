// The library's repository: articles and their translations, in the database (saved words are cards: cards.ts).
// The JSON files under userData/library are only ever read, once, by db/migrate-json.ts.

import crypto from "node:crypto";
import { type Insertable, type Kysely } from "kysely";
import { withTx, type DB } from "./db";
import type { ArticlesTable } from "./db/schema";
import type { Article, ArticleSummary } from "../shared/types";

/** Database or open transaction: every helper here works inside either. */
type Db = Kysely<DB>;

export function articleIdFor(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return crypto.createHash("sha1").update(u.toString()).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------- articles

/**
 * What `body_json` holds: the article's heavy fields as saved, plus how its
 * translations map onto the `translations` table.
 * - `targets`: the article's `translationsTo` languages (present iff it had `translationsTo`),
 *   so an empty target map survives the trip.
 * - `stray`: translations of text that is no longer one of the article's sentences (or that
 *   aren't text). They are never shown, but the upgrade loses nothing, so they are kept here.
 */
interface Body {
  blocks?: Article["blocks"];
  translations?: Article["translations"];
  cues?: Article["cues"];
  targets?: string[];
  stray?: Record<string, Record<string, string>>;
}

/** The article's translatable text in order: the title, then each sentence. A translation row's
 * `sentence` is an index into this list (the first occurrence of its text). */
function units(a: Pick<Article, "title" | "blocks">): string[] {
  const blocks = Array.isArray(a.blocks) ? a.blocks : [];
  return [a.title ?? "", ...blocks.flatMap((b) => (Array.isArray(b?.sentences) ? b.sentences : []))];
}

const timeOf = (iso: unknown): number => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function articleRow(summary: ArticleSummary, body: Body | null, listed: boolean): Insertable<ArticlesTable> {
  return {
    id: summary.id,
    url: String(summary.url ?? ""),
    lang: String(summary.language ?? ""),
    title: String(summary.title ?? ""),
    source: String(summary.source ?? ""),
    kind: summary.kind ?? "article",
    added_at: timeOf(summary.savedAt),
    summary_json: JSON.stringify(summary),
    body_json: body ? JSON.stringify(body) : null,
    listed: listed ? 1 : 0,
  };
}

type TranslationRow = Insertable<DB["translations"]>;

/** Splits one target's translations into table rows (text that is one of the article's units)
 * and stray ones, which are recorded in `body.stray`. Returns the rows. */
function placeTranslations(id: string, text: string[], body: Body, tgt: string, map: Record<string, unknown>): TranslationRow[] {
  const first = new Map<string, number>();
  text.forEach((u, i) => first.has(u) || first.set(u, i));
  const rows: TranslationRow[] = [];
  for (const [t, translation] of Object.entries(map ?? {})) {
    const i = typeof translation === "string" ? first.get(t) : undefined;
    if (i !== undefined) rows.push({ article_id: id, target_lang: tgt, sentence: i, text: translation as string });
    else ((body.stray ??= {})[tgt] ??= {})[t] = translation as string;
  }
  return rows;
}

/** Inserts translation rows, replacing the text of rows that already exist. */
async function upsertTranslations(db: Db, rows: TranslationRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500)
    await db
      .insertInto("translations")
      .values(rows.slice(i, i + 500))
      .onConflict((oc) => oc.columns(["article_id", "target_lang", "sentence"]).doUpdateSet({ text: (eb) => eb.ref("excluded.text") }))
      .execute();
}

/**
 * Writes an article. Unless `translations` is false, its translation rows are replaced by its
 * `translationsTo`. `listed: false` keeps it out of the library list (old unindexed files);
 * saving an article lists it, as saving did with the JSON index.
 */
export async function writeArticle(db: Db, article: Article, opts: { translations?: boolean; listed?: boolean } = {}): Promise<void> {
  const { blocks, translations, translationsTo, cues, ...summary } = article;
  const body: Body = { blocks, translations, cues };
  const rows: TranslationRow[] = [];
  if (translationsTo) {
    body.targets = Object.keys(translationsTo);
    for (const [tgt, map] of Object.entries(translationsTo)) rows.push(...placeTranslations(article.id, units(article), body, tgt, map));
  }
  const row = articleRow(summary, body, opts.listed ?? true);
  await db.insertInto("articles").values(row).onConflict((oc) => oc.column("id").doUpdateSet(row)).execute();
  if (opts.translations === false) return;
  await db.deleteFrom("translations").where("article_id", "=", article.id).execute();
  await upsertTranslations(db, rows);
}

/** An index entry whose article file is gone: it is listed, and opens as missing (as before). */
export async function writeSummaryOnly(db: Db, summary: ArticleSummary): Promise<void> {
  await db.insertInto("articles").values(articleRow(summary, null, true)).execute();
}

async function readArticle(db: Db, id: string): Promise<Article | null> {
  const row = await db.selectFrom("articles").select(["summary_json", "body_json"]).where("id", "=", id).executeTakeFirst();
  if (!row?.body_json || !row.summary_json) return null;
  const { targets, stray, ...body } = JSON.parse(row.body_json) as Body;
  const article = { ...(JSON.parse(row.summary_json) as ArticleSummary), ...body } as Article;
  // An imported file may have had no sentences: it opens as empty (and is fetched again), never as a crash.
  if (!Array.isArray(article.blocks)) article.blocks = [];
  if (targets) {
    const text = units(article);
    const to: Record<string, Record<string, string>> = Object.fromEntries(targets.map((t) => [t, { ...stray?.[t] }]));
    const rows = await db.selectFrom("translations").select(["target_lang", "sentence", "text"]).where("article_id", "=", id).execute();
    for (const r of rows) if (text[r.sentence] !== undefined) (to[r.target_lang] ??= {})[text[r.sentence]] = r.text;
    article.translationsTo = to;
  }
  return article;
}

/** Articles saved by older versions as "video" are kept but never shown. */
const visible = (a: Article | null) => (a && a.kind !== "video" ? a : null);

// ---------------------------------------------------------------- the repository

export function createLibrary(db: Kysely<DB>) {
  return {
    /** Newest first, as the JSON store listed them (an imported article with no date comes last). */
    async listArticles(): Promise<ArticleSummary[]> {
      const rows = await db
        .selectFrom("articles")
        .select("summary_json")
        .where("kind", "!=", "video")
        .where("listed", "=", 1)
        .orderBy("added_at", "desc")
        .execute();
      return rows.map((r) => JSON.parse(r.summary_json ?? "null") as ArticleSummary).filter(Boolean);
    },

    async getArticle(id: string): Promise<Article | null> {
      return visible(await readArticle(db, id));
    },

    saveArticle(article: Article): Promise<void> {
      return withTx(db, (trx) => writeArticle(trx, article));
    },

    /** Merges `patch` like the JSON store did: translation maps are merged per target, not replaced. */
    updateArticle(id: string, patch: Partial<Article>): Promise<void> {
      return withTx(db, async (trx) => {
        const existing = visible(await readArticle(trx, id));
        if (!existing) return;
        const next: Article = { ...existing, ...patch, id: existing.id };
        if (patch.translations) next.translations = { ...existing.translations, ...patch.translations };
        if (patch.translationsTo) {
          const merged = { ...existing.translationsTo };
          for (const [tgt, map] of Object.entries(patch.translationsTo)) merged[tgt] = { ...merged[tgt], ...map };
          next.translationsTo = merged;
        }
        // Reading progress and flags leave the translation rows alone.
        const touchesText = "translationsTo" in patch || "blocks" in patch || "title" in patch;
        await writeArticle(trx, next, { translations: touchesText });
      });
    },

    async removeArticle(id: string): Promise<void> {
      await db.deleteFrom("articles").where("id", "=", id).execute(); // translations cascade
    },

    /** Adds or replaces translations into `tgt`: only their own rows are written. */
    putTranslations(id: string, tgt: string, map: Record<string, string>): Promise<void> {
      return withTx(db, async (trx) => {
        const row = await trx.selectFrom("articles").select(["title", "kind", "body_json"]).where("id", "=", id).executeTakeFirst();
        if (!row?.body_json || row.kind === "video") return;
        const body = JSON.parse(row.body_json) as Body;
        const before = row.body_json;
        if (!body.targets?.includes(tgt)) body.targets = [...(body.targets ?? []), tgt];
        await upsertTranslations(trx, placeTranslations(id, units({ title: row.title, blocks: body.blocks ?? [] }), body, tgt, map));
        const after = JSON.stringify(body);
        if (after !== before) await trx.updateTable("articles").set({ body_json: after }).where("id", "=", id).execute();
      });
    },

  };
}

export type Library = ReturnType<typeof createLibrary>;

/** The article id for a saved word's link, or null when it isn't a web address. */
export function safeArticleId(url: unknown): string | null {
  try {
    return typeof url === "string" && /^https?:/i.test(url) ? articleIdFor(url) : null;
  } catch {
    return null;
  }
}
