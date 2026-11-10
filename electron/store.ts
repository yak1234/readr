// Readr's stores. Articles, translations and saved words live in the database, through
// library.ts; this module keeps the small configuration files (sources, sections, stations,
// channels, logins) as JSON in Electron's userData folder.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { sanitizeStations } from "./stations";
import { sanitizeChannels } from "./channels";
import type { Library } from "./library";
import type { Classification } from "../shared/site-kinds";
import type { SavedChannel, SavedStation, Article, ArticleSummary, UserSource, Section } from "../shared/types";

export { articleIdFor } from "./library";

const root = () => path.join(app.getPath("userData"), "library");

/** The folder of the JSON files, the old library's among them (kept as a backup after the upgrade). */
export const libraryDir = root;

function ensureDirs() {
  fs.mkdirSync(root(), { recursive: true });
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

// ---------------------------------------------------------------- library (database)

let library: Library | null = null;

/** Set once the library's upgrade has succeeded (see library-startup.ts); null detaches it. */
export function attachLibrary(lib: Library | null) {
  library = lib;
}

function lib(): Library {
  if (!library) throw new Error("The library isn't available until its upgrade into the database succeeds.");
  return library;
}

export async function listArticles(): Promise<ArticleSummary[]> {
  return lib().listArticles();
}

export async function getArticle(id: string): Promise<Article | null> {
  return lib().getArticle(id);
}

export async function saveArticle(article: Article): Promise<void> {
  return lib().saveArticle(article);
}

export async function updateArticle(id: string, patch: Partial<Article>): Promise<void> {
  return lib().updateArticle(id, patch);
}

export async function deleteArticle(id: string): Promise<void> {
  return lib().removeArticle(id);
}

export async function putTranslations(id: string, tgt: string, map: Record<string, string>): Promise<void> {
  return lib().putTranslations(id, tgt, map);
}

// ---------------------------------------------------------------- configuration (JSON)

export function listUserSources(): UserSource[] {
  ensureDirs();
  return readJson<UserSource[]>(path.join(root(), "sources.json"), []);
}

export function saveUserSources(sources: UserSource[]) {
  ensureDirs();
  writeJson(path.join(root(), "sources.json"), sources);
}

/** The section ids a source's reader follows; `null` means never chosen (the default feeds apply). */
export function getFollowed(sourceId: string): string[] | null {
  return readJson<Record<string, string[]>>(path.join(root(), "followed.json"), {})[sourceId] ?? null;
}

/** `sections` are saved with the ids so followed discovered sections resolve without the discovery cache. */
export function setFollowed(sourceId: string, ids: string[], sections: Section[] = []) {
  ensureDirs();
  const file = path.join(root(), "followed.json");
  writeJson(file, { ...readJson<Record<string, string[]>>(file, {}), [sourceId]: ids });
  const sFile = path.join(root(), "followed-sections.json");
  writeJson(sFile, { ...readJson<Record<string, Section[]>>(sFile, {}), [sourceId]: sections.filter((s) => ids.includes(s.id)) });
}

export function getFollowedSections(): Record<string, Section[]> {
  return readJson<Record<string, Section[]>>(path.join(root(), "followed-sections.json"), {});
}

/** Sections discovered on added sources' sites, so they load without the network. */
export function getSectionsCache(): Record<string, Section[]> {
  return readJson<Record<string, Section[]>>(path.join(root(), "sections-cache.json"), {});
}

export function setSectionsCache(sourceId: string, sections: Section[]) {
  ensureDirs();
  writeJson(path.join(root(), "sections-cache.json"), { ...getSectionsCache(), [sourceId]: sections });
}

/** `null` when no stations file exists yet (first run). */
export function loadStations(): SavedStation[] | null {
  return sanitizeStations(readJson<unknown>(path.join(root(), "stations.json"), null));
}

export function saveStations(stations: SavedStation[]) {
  ensureDirs();
  writeJson(path.join(root(), "stations.json"), stations);
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

/** Sites whose logins the user chose to import from their browser. */
export function getImportSites(): string[] {
  return readJson<{ sites?: string[] }>(path.join(root(), "import-sites.json"), {}).sites ?? [];
}

export function setImportSites(sites: string[]) {
  ensureDirs();
  writeJson(path.join(root(), "import-sites.json"), { sites });
}

/** The model's label for each site, so only new sites are classified. */
export function getSiteKinds(): Record<string, Classification> {
  return readJson<Record<string, Classification>>(path.join(root(), "site-kinds.json"), {});
}

export function addSiteKinds(more: Record<string, Classification>) {
  ensureDirs();
  writeJson(path.join(root(), "site-kinds.json"), { ...getSiteKinds(), ...more });
}

/** Ids of built-in stations already offered to this user (they are never re-added once removed). */
export function loadOfferedBuiltins(): string[] {
  const raw = readJson<unknown>(path.join(root(), "builtin-stations.json"), []);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

export function saveOfferedBuiltins(ids: string[]) {
  ensureDirs();
  writeJson(path.join(root(), "builtin-stations.json"), ids);
}

/** `null` when no channels file exists yet (first run). */
export function loadChannels(): SavedChannel[] | null {
  return sanitizeChannels(readJson<unknown>(path.join(root(), "channels.json"), null));
}

export function saveChannels(channels: SavedChannel[]) {
  ensureDirs();
  writeJson(path.join(root(), "channels.json"), channels);
}

/** Ids of built-in TV channels already offered to this user (never re-added once removed). */
export function loadOfferedChannels(): string[] {
  const raw = readJson<unknown>(path.join(root(), "builtin-channels.json"), []);
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

export function saveOfferedChannels(ids: string[]) {
  ensureDirs();
  writeJson(path.join(root(), "builtin-channels.json"), ids);
}

/** Where the Find channels index is cached. */
export const tvCacheDir = () => root();
