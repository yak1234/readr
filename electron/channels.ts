// Saved TV channels: the user's list, filed by language, plus the official
// news channels offered once to every user (the same pattern as built-in stations).

import type { Channel, SavedChannel } from "../shared/types";
import { isHttpUrl } from "../shared/live";
import { offerOnce } from "./stations";

const builtin = (id: string, name: string, lang: string, country: string, website: string, url: string): SavedChannel => ({
  id: `builtin-tv-${id}`,
  name,
  url,
  website,
  country,
  languages: [lang],
  categories: ["news"],
  lang,
});

/** Official streams, on the broadcaster's own domain or the one its own site plays,
 * that play without a spoofed User-Agent or Referer (checked 2026-11-08). */
export const BUILTIN_CHANNELS: SavedChannel[] = [
  builtin("france24-fr", "France 24", "fr", "FR", "https://www.france24.com/fr/", "https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_5000.m3u8"),
  builtin("euronews-fr", "Euronews", "fr", "FR", "https://fr.euronews.com/", "https://cdn-euronews.akamaized.net/live/eds/euronews-fr/25026/index.m3u8"),
  builtin("asharq", "Asharq News", "ar", "SA", "https://asharq.com/", "https://live-news.asharq.com/asharq.m3u8"),
  builtin("aljazeera", "Al Jazeera", "ar", "QA", "https://www.aljazeera.net/", "https://live-hls-web-aja-gcp.thehlive.com/AJA/index.m3u8"),
  builtin("alarabiya", "Al Arabiya", "ar", "AE", "https://www.alarabiya.net/", "https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8"),
  builtin("skynewsarabia", "Sky News Arabia", "ar", "AE", "https://www.skynewsarabia.com/", "https://live-stream.skynewsarabia.com/c-horizontal-channel/horizontal-stream/index.m3u8"),
  builtin("france24-ar", "France 24 Arabic", "ar", "FR", "https://www.france24.com/ar/", "https://live.france24.com/hls/live/2037222/F24_AR_HI_HLS/master_5000.m3u8"),
];

/** Adds each built-in not yet offered, once: a removed one stays removed. `saved === null` is the first run. */
export function mergeBuiltinChannels(saved: SavedChannel[] | null, offered: string[]): { channels: SavedChannel[]; offered: string[] } {
  const r = offerOnce(saved ?? [], BUILTIN_CHANNELS, offered);
  return { channels: r.list, offered: r.offered };
}

export function saveChannel(list: SavedChannel[], channel: Channel, lang: string): SavedChannel[] {
  const entry: SavedChannel = { ...channel, lang };
  const i = list.findIndex((c) => c.id === entry.id);
  if (i < 0) return [...list, entry];
  return list.map((c, j) => (j === i ? entry : c));
}

export function removeChannel(list: SavedChannel[], id: string): SavedChannel[] {
  return list.filter((c) => c.id !== id);
}

/** A channel the renderer may save or preview: an http(s) url, a name, an id and string languages. */
export function isValidChannel(c: unknown): c is Channel {
  const o = c as Record<string, unknown> | null;
  return (
    typeof o === "object" &&
    o !== null &&
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.url === "string" &&
    isHttpUrl(o.url) &&
    Array.isArray(o.languages) &&
    o.languages.every((l) => typeof l === "string")
  );
}

/** Only the fields a channel has, so nothing else from the renderer is stored. */
export function cleanChannel(c: Channel): Channel {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { id: c.id, name: c.name, url: c.url, website: str(c.website), country: str(c.country), languages: list(c.languages), categories: list(c.categories), ...(c.altNames ? { altNames: list(c.altNames) } : {}) };
}

/** A channels file's contents: `null` (as if absent) unless it is a list; entries of the wrong shape are dropped. */
export function sanitizeChannels(raw: unknown): SavedChannel[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((c): c is SavedChannel => isValidChannel(c) && typeof (c as SavedChannel).lang === "string");
}
