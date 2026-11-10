// Saved radio stations: the user's list, grouped by drawer language.

import type { SavedStation, Station } from "../shared/types";
import { LIVE_CHANNELS, isHttpUrl } from "../shared/live";

export type { SavedStation };

const SEED_IDS: Record<string, string> = {
  "radio-franceinfo": "seed-franceinfo",
  "radio-franceinter": "seed-franceinter",
  "radio-franceculture": "seed-franceculture",
  "radio-mcd": "seed-mcd",
};

/** Today's built-in radio entries, so the first run still has stations. */
export const SEED_STATIONS: SavedStation[] = LIVE_CHANNELS.filter((c) => c.kind === "radio").map((c) => ({
  id: SEED_IDS[c.id] ?? `seed-${c.id}`,
  name: c.name,
  url: c.url,
  homepage: "",
  favicon: "",
  country: "",
  countrycode: "",
  languages: [c.lang],
  tags: [],
  codec: "MP3",
  bitrate: 0,
  hls: false,
  lang: c.lang,
}));

/** Online streams offered once to every user (see `mergeBuiltins`). */
export const BUILTIN_STATIONS: SavedStation[] = [
  {
    id: "builtin-bfm-business",
    name: "BFM Business",
    url: "https://audio.bfmtv.com/bfmbusiness_128.mp3",
    homepage: "",
    favicon: "",
    country: "France",
    countrycode: "FR",
    languages: ["fr"],
    tags: [],
    codec: "MP3",
    bitrate: 128,
    hls: false,
    lang: "fr",
  },
];

/** Adds each built-in not yet offered, once: `offered` records ids already given, so a removed one stays removed.
 * `saved === null` (first run) starts from the seeds. */
export function mergeBuiltins(saved: SavedStation[] | null, offered: string[]): { stations: SavedStation[]; offered: string[] } {
  const r = offerOnce(withSeed(saved), BUILTIN_STATIONS, offered);
  return { stations: r.list, offered: r.offered };
}

/** Appends each built-in whose id is not in `offered` (unless the list already has it), and records it as offered. */
export function offerOnce<T extends { id: string; url: string }>(list: T[], builtins: T[], offered: string[]): { list: T[]; offered: string[] } {
  let out = list;
  const nowOffered = [...offered];
  for (const b of builtins) {
    if (nowOffered.includes(b.id)) continue;
    nowOffered.push(b.id);
    if (!out.some((s) => s.id === b.id || s.url === b.url)) out = [...out, { ...b }];
  }
  return { list: out, offered: nowOffered };
}

/** `null` means no stations file yet (first run); an empty list is the user's choice. */
export function withSeed(saved: SavedStation[] | null): SavedStation[] {
  return saved === null ? SEED_STATIONS.map((s) => ({ ...s })) : saved;
}

export function saveStation(list: SavedStation[], station: SavedStation | Omit<SavedStation, "lang">, lang: string): SavedStation[] {
  const entry = { ...station, lang } as SavedStation;
  const i = list.findIndex((s) => s.id === entry.id);
  if (i < 0) return [...list, entry];
  return list.map((s, j) => (j === i ? entry : s));
}

export function removeStation(list: SavedStation[], id: string): SavedStation[] {
  return list.filter((s) => s.id !== id);
}

/** A station the renderer may save or preview: an http(s) url, a name, and string languages. */
export function isValidStation(s: unknown): s is Station {
  const o = s as Record<string, unknown> | null;
  return (
    typeof o === "object" &&
    o !== null &&
    typeof o.url === "string" &&
    isHttpUrl(o.url) &&
    typeof o.name === "string" &&
    typeof o.id === "string" &&
    Array.isArray(o.languages) &&
    o.languages.every((l) => typeof l === "string")
  );
}

/** A stations file's contents: `null` (as if absent) unless it is a list; entries of the wrong shape are dropped. */
export function sanitizeStations(raw: unknown): SavedStation[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((s): s is SavedStation => isValidStation(s));
}
