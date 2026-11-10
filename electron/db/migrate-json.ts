// The one-time upgrade from the JSON library (userData/library) into the database.
// It only reads the JSON files, writes everything in one transaction, and marks itself
// done in `meta`, so a re-run is a no-op and a failure leaves no trace.

import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import { withTx, type DB } from "./index";
import { safeArticleId, writeArticle, writeSummaryOnly } from "../library";
import { legacyVocabOrigin, readLangHints } from "../lang-hints";
import { addCardFromLegacy, cardLanguage, legacyForm } from "../cards";
import { isObject, str } from "../json-values";
import type { Article, ArticleSummary, VocabEntry } from "../../shared/types";

export const JSON_IMPORT_DONE = "json_import_done";

export interface ImportOptions {
  /** The app's language (settings.currentLang): the last resort for a saved word's language. */
  fallbackLang?: string;
  now?: Date;
}

export interface ImportResult {
  articles: number;
  examples: number;
  /** Malformed rows left out (each is logged). Old video articles are not counted: they were already hidden. */
  skipped: number;
}

interface LegacyLibrary {
  articles: Article[];
  /** Ids of article files the index never listed (an interrupted save): kept, not listed, as before. */
  unindexed: Set<string>;
  /** Index entries whose article file is missing: listed, but they open as missing, as before. */
  indexOnly: ArticleSummary[];
  /** The language of every article on disk by id, hidden video ones included. */
  langs: Map<string, string>;
  vocab: VocabEntry[];
  skipped: number;
}


/** A JSON file's contents, or `undefined` when it doesn't exist. Unreadable files throw. */
function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  return JSON.parse(text);
}

function skip(what: string, why: string) {
  console.warn(`Library upgrade: skipped ${what} (${why}).`);
}

function readLegacyLibrary(dir: string): LegacyLibrary {
  const lib: LegacyLibrary = { articles: [], unindexed: new Set(), indexOnly: [], langs: new Map(), vocab: [], skipped: 0 };
  const ids = new Set<string>();

  // Article files are the full record; the index only mirrored their summaries.
  const articlesDir = path.join(dir, "articles");
  const files = fs.existsSync(articlesDir) ? fs.readdirSync(articlesDir).filter((n) => n.endsWith(".json")).sort() : [];
  for (const name of files) {
    let a: unknown;
    try {
      a = readJson(path.join(articlesDir, name));
    } catch (e) {
      lib.skipped++;
      skip(`articles/${name}`, (e as Error).message);
      continue;
    }
    if (!isObject(a) || !str(a.id) || ids.has(str(a.id))) {
      lib.skipped++;
      skip(`articles/${name}`, isObject(a) && str(a.id) ? "duplicate id" : "not an article");
      continue;
    }
    ids.add(str(a.id));
    lib.langs.set(str(a.id), str(a.language));
    if (a.kind !== "video") lib.articles.push(a as unknown as Article);
  }

  let index: unknown = [];
  try {
    index = readJson(path.join(dir, "index.json")) ?? [];
  } catch (e) {
    skip("index.json", `${(e as Error).message}; the article files are imported`);
  }
  const indexed = new Set<string>();
  for (const [i, s] of (Array.isArray(index) ? index : []).entries()) {
    if (!isObject(s) || !str(s.id)) {
      lib.skipped++;
      skip(`index.json entry ${i}`, "not an article summary");
      continue;
    }
    indexed.add(str(s.id));
    if (!ids.has(str(s.id))) {
      ids.add(str(s.id));
      lib.langs.set(str(s.id), str(s.language));
      if (s.kind !== "video") lib.indexOnly.push(s as unknown as ArticleSummary);
    }
  }

  for (const a of lib.articles) if (!indexed.has(a.id)) lib.unindexed.add(a.id);

  // Losing every saved word to one bad byte is worse than not upgrading: an unreadable file fails the upgrade.
  let vocab: unknown;
  try {
    vocab = readJson(path.join(dir, "vocab.json")) ?? [];
  } catch (e) {
    throw new Error(`vocab.json could not be read: ${(e as Error).message}`);
  }
  if (!Array.isArray(vocab)) throw new Error("vocab.json could not be read: it is not a list");
  for (const [i, v] of vocab.entries()) {
    if (!isObject(v) || !str(v.word).trim()) {
      lib.skipped++;
      skip(`saved word ${i}`, "no word");
      continue;
    }
    lib.vocab.push({
      id: str(v.id),
      word: str(v.word),
      lemma: str(v.lemma),
      gloss: str(v.gloss),
      sentence: str(v.sentence),
      sentenceTranslation: str(v.sentenceTranslation),
      articleUrl: str(v.articleUrl),
      articleTitle: str(v.articleTitle),
      addedAt: str(v.addedAt),
    });
  }
  return lib;
}

/** The most common article language, for when the app's language isn't known yet. */
function commonest(langs: Iterable<string>): string | undefined {
  const n = new Map<string, number>();
  for (const l of langs) if (l) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const isDone = async (db: Kysely<DB>) =>
  (await db.selectFrom("meta").select("value").where("key", "=", JSON_IMPORT_DONE).executeTakeFirst())?.value === "1";

/**
 * Copies the JSON library into the database, once. Articles keep every field and their
 * translations; each valid saved word becomes a card example (see cards.addCardFromLegacy).
 * The JSON files are never written.
 */
export async function importJsonLibrary(db: Kysely<DB>, libraryDir: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const none = { articles: 0, examples: 0, skipped: 0 };
  if (await isDone(db)) return none;
  const legacy = readLegacyLibrary(libraryDir);
  const now = opts.now ?? new Date();
  const hints = {
    ...readLangHints(libraryDir),
    articleLang: (url: string) => legacy.langs.get(safeArticleId(url) ?? "") || undefined,
    fallback: opts.fallbackLang ?? "",
  };
  const commonestLang = commonest(legacy.langs.values());
  const imported = new Set([...legacy.articles, ...legacy.indexOnly].map((a) => a.id));

  return withTx(db, async (trx) => {
    if (await isDone(trx)) return none;
    for (const a of legacy.articles) await writeArticle(trx, a, { listed: !legacy.unindexed.has(a.id) });
    for (const s of legacy.indexOnly) await writeSummaryOnly(trx, s);
    for (const v of legacy.vocab) {
      const articleId = safeArticleId(v.articleUrl);
      const sourceId = articleId && imported.has(articleId) ? articleId : null;
      const origin = legacyVocabOrigin(v.articleUrl, hints);
      const lang = await cardLanguage(legacyForm(v), origin.lang, () => commonestLang);
      await addCardFromLegacy(trx, v, lang, { kind: origin.kind, sourceId, now });
    }
    await trx.insertInto("meta").values({ key: JSON_IMPORT_DONE, value: "1" }).execute();
    return { articles: imported.size, examples: legacy.vocab.length, skipped: legacy.skipped };
  });
}
