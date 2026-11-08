// Tiny JSON-file store in Electron's userData folder.
// One file per article keeps writes small; an index file keeps the sidebar fast.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Article, ArticleSummary, VocabEntry } from "../shared/types";

const root = () => path.join(app.getPath("userData"), "library");
const articlesDir = () => path.join(root(), "articles");
const indexFile = () => path.join(root(), "index.json");
const vocabFile = () => path.join(root(), "vocab.json");

function ensureDirs() {
  fs.mkdirSync(articlesDir(), { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function articleIdFor(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.search = "";
  return crypto.createHash("sha1").update(u.toString()).digest("hex").slice(0, 16);
}

function summarize(a: Article): ArticleSummary {
  const { blocks: _b, translations: _t, cues: _c, ...rest } = a;
  return rest;
}

export function listArticles(): ArticleSummary[] {
  ensureDirs();
  return readJson<ArticleSummary[]>(indexFile(), []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export function getArticle(id: string): Article | null {
  ensureDirs();
  return readJson<Article | null>(path.join(articlesDir(), `${id}.json`), null);
}

export function saveArticle(article: Article) {
  ensureDirs();
  writeJson(path.join(articlesDir(), `${article.id}.json`), article);
  const index = readJson<ArticleSummary[]>(indexFile(), []).filter((a) => a.id !== article.id);
  index.push(summarize(article));
  writeJson(indexFile(), index);
}

export function updateArticle(id: string, patch: Partial<Article>) {
  const existing = getArticle(id);
  if (!existing) return;
  const next = { ...existing, ...patch, id: existing.id };
  if (patch.translations) next.translations = { ...existing.translations, ...patch.translations };
  saveArticle(next);
}

export function deleteArticle(id: string) {
  ensureDirs();
  fs.rmSync(path.join(articlesDir(), `${id}.json`), { force: true });
  writeJson(indexFile(), readJson<ArticleSummary[]>(indexFile(), []).filter((a) => a.id !== id));
}

export function listVocab(): VocabEntry[] {
  ensureDirs();
  return readJson<VocabEntry[]>(vocabFile(), []);
}

export function addVocab(entry: Omit<VocabEntry, "id" | "addedAt">): VocabEntry {
  const all = listVocab();
  const existing = all.find((v) => v.lemma === entry.lemma && v.sentence === entry.sentence);
  if (existing) return existing;
  const full: VocabEntry = { ...entry, id: crypto.randomUUID(), addedAt: new Date().toISOString() };
  all.push(full);
  writeJson(vocabFile(), all);
  return full;
}

export function updateVocab(id: string, patch: Partial<VocabEntry>) {
  writeJson(vocabFile(), listVocab().map((v) => (v.id === id ? { ...v, ...patch, id } : v)));
}

/** Which everyday browser the user copied logins from, if any, so Readr can
 * refresh them by itself when a site logs it out. */
export function getLoginBrowser(): string | null {
  return readJson<{ browser?: string }>(path.join(root(), "browser-login.json"), {}).browser ?? null;
}

export function setLoginBrowser(browser: string) {
  ensureDirs();
  writeJson(path.join(root(), "browser-login.json"), { browser });
}

/** Folder for screenshots and audio clips of saved video lines. */
export function mediaDir(): string {
  const dir = path.join(root(), "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeVocab(id: string) {
  writeJson(vocabFile(), listVocab().filter((v) => v.id !== id));
}

/** Anki-friendly TSV: Front (word + sentence) / Back (gloss + translation). */
export function vocabToTsv(entries: VocabEntry[]): string {
  const esc = (s: string) => s.replace(/\t/g, " ").replace(/\r?\n/g, " ");
  const lines = ["#separator:tab", "#html:true", "#columns:Front\tBack\tTags"];
  for (const v of entries) {
    const highlighted = esc(v.sentence).replace(
      new RegExp(`(${v.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i"),
      "<b>$1</b>",
    );
    const front = `<b>${esc(v.word)}</b><br><i>${highlighted}</i>`;
    const back = `${esc(v.lemma)} — ${esc(v.gloss)}<br><i>${esc(v.sentenceTranslation)}</i>`;
    lines.push(`${front}\t${back}\treadr`);
  }
  return lines.join("\n") + "\n";
}
