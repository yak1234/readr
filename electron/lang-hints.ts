// Where a saved word came from, worked out from the library folder's small JSON files: its
// language and whether it was met reading, on the radio or on TV. Used by the one-time import
// (db/migrate-json.ts) and when a word is saved.

import fs from "node:fs";
import path from "node:path";
import type { ExampleSourceKind } from "./db/schema";
import { SITES } from "./sites";
import { isObject, str } from "./json-values";

/** What a saved word's language is worked out from, most telling first. */
export interface LangHints {
  /** The language of the saved article at this address, if there is one. */
  articleLang(url: string): string | undefined;
  /** News sources (built in and added) by host. */
  sources: { hosts: string[]; lang: string }[];
  /** Saved radio stations and TV channels by stream address: a word saved while listening links to its stream. */
  live: Map<string, { lang: string; kind: "radio" | "tv" }>;
  /** The language the app shows. */
  fallback: string;
}

export interface Origin {
  lang: string;
  kind: ExampleSourceKind;
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** A saved word's language and source kind. The language is its saved article's, else that of
 * the station or channel at exactly its address, else that of the source whose host its link
 * is on, else the app's language. */
export function legacyVocabOrigin(url: string, hints: LangHints): Origin {
  const live = hints.live.get(url);
  const kind = live?.kind ?? "article";
  const host = hostOf(url);
  const source = host ? hints.sources.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) : undefined;
  return { lang: (url && hints.articleLang(url)) || live?.lang || source?.lang || hints.fallback, kind };
}

function readList(file: string): Record<string, unknown>[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw.filter(isObject) : [];
  } catch {
    return []; // a missing or unreadable list only means fewer hints
  }
}

/** The source, station and channel hints kept in the library folder's small JSON files. */
export function readLangHints(libraryDir: string): Pick<LangHints, "sources" | "live"> {
  const sources = [
    ...SITES.map((s) => ({ hosts: s.hosts, lang: s.lang })),
    ...readList(path.join(libraryDir, "sources.json")).map((s) => ({
      hosts: Array.isArray(s.hosts) ? s.hosts.filter((h): h is string => typeof h === "string").map((h) => h.toLowerCase()) : [],
      lang: str(s.lang),
    })),
  ].filter((s) => s.lang && s.hosts.length);
  const live = new Map<string, { lang: string; kind: "radio" | "tv" }>();
  for (const [file, kind] of [["stations.json", "radio"], ["channels.json", "tv"]] as const)
    for (const s of readList(path.join(libraryDir, file))) if (str(s.url) && str(s.lang)) live.set(str(s.url), { lang: str(s.lang), kind });
  return { sources, live };
}
