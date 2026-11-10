// Find channels: the iptv-org index (https://iptv-org.github.io/api), cut down to
// official streams. It is downloaded on first use, cached in userData, and
// refreshed at most daily. Nothing here spoofs a browser: entries that need a
// User-Agent or Referer are dropped.

import fs from "node:fs";
import path from "node:path";
import { getDomain, getDomainWithoutSuffix } from "tldts";
import type { Channel, TvQuery } from "../shared/types";

export const IPTV_API = "https://iptv-org.github.io/api";

export interface IptvStream {
  channel: string | null;
  feed: string | null;
  title?: string;
  url: string;
  quality?: string | null;
  user_agent: string | null;
  referrer: string | null;
}

export interface IptvChannel {
  id: string;
  name: string;
  alt_names?: string[];
  country: string;
  categories: string[];
  is_nsfw: boolean;
  closed: string | null;
  website: string | null;
}

export interface IptvFeed {
  channel: string;
  id: string;
  name?: string;
  is_main: boolean;
  languages: string[];
}

/** ISO 639-3 (the index) to the codes Readr uses (shared/languages.json). */
const ISO3: Record<string, string> = {
  ara: "ar", fra: "fr", eng: "en", spa: "es", por: "pt", deu: "de", ita: "it", rus: "ru", zho: "zh", cmn: "zh", jpn: "ja", kor: "ko",
  tur: "tr", fas: "fa", pes: "fa", nld: "nl", pol: "pl", ukr: "uk", ces: "cs", cze: "cs", slk: "sk", slv: "sl", hrv: "hr", srp: "sr",
  bos: "bs", bul: "bg", mkd: "mk", sqi: "sq", ell: "el", ron: "ro", hun: "hu", swe: "sv", dan: "da", nor: "no", nob: "no", fin: "fi",
  isl: "is", gle: "ga", mlt: "mt", est: "et", lav: "lv", lit: "lt", bel: "be", cat: "ca", eus: "eu", glg: "gl", heb: "he", hin: "hi",
  urd: "ur", ben: "bn", tam: "ta", tel: "te", mar: "mr", guj: "gu", pan: "pa", kan: "kn", mal: "ml", nep: "ne", sin: "si", tha: "th",
  vie: "vi", ind: "id", msa: "ms", zsm: "ms", tgl: "tl", fil: "tl", khm: "km", mya: "my", lao: "lo", kaz: "kk", mon: "mn", uig: "ug",
  bod: "bo", aze: "az", kat: "ka", hye: "hy", kur: "ku", pus: "ps", amh: "am", hau: "ha", som: "so", yor: "yo", zul: "zu", afr: "af",
  swa: "sw", swh: "sw",
};

export function iso1(code: string): string | null {
  return ISO3[code] ?? null;
}

export const isBareIp = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

/** Hosts that only exist on this machine or the local network. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".lan", ".home.arpa", ".internal", ".localdomain"];
const isLocalName = (host: string) => host === "localhost" || !host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s));

/** An http(s) address on a public host name: never a bare IP (loopback, private LAN or
 * otherwise), localhost or a local-network name. Channels are only fetched from these. */
export function isPublicStreamUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== null && !isBareIp(host) && !isLocalName(host);
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 2: same registrable domain as the channel's website; 1: a host named after the
 * broadcaster (its own CDN name, "cdn-euronews.akamaized.net"); 0: anyone else. */
function officialRank(host: string, website: string | null): number {
  const site = website ? hostOf(website) : null;
  if (!site) return 0;
  // Private suffixes (github.io, akamaized.net…) count as their own domains: two sites there aren't one owner.
  const opts = { allowPrivateDomains: true };
  const domain = getDomain(site, opts);
  if (domain && getDomain(host, opts) === domain) return 2;
  // The broadcaster's own CDN name: a host label, or a hyphen-separated part of one, that is or begins with its name.
  const brand = getDomainWithoutSuffix(site, opts)?.toLowerCase();
  if (!brand || brand.length < 4) return 0;
  return host.split(/[.-]/).some((part) => part.startsWith(brand)) ? 1 : 0;
}

/** Official, playable-without-spoofing streams, one per channel feed. */
export function officialStreams(streams: IptvStream[], channels: IptvChannel[], feeds: IptvFeed[]): Channel[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  const feedOf = new Map(feeds.map((f) => [`${f.channel}@${f.id}`, f]));
  const mainFeed = new Map(feeds.filter((f) => f.is_main).map((f) => [f.channel, f]));
  const best = new Map<string, { rank: number; channel: Channel }>();
  for (const s of streams) {
    if (!s.channel || s.user_agent || s.referrer) continue;
    const host = hostOf(s.url);
    if (!host || isBareIp(host)) continue;
    const ch = byId.get(s.channel);
    if (!ch || ch.closed || ch.is_nsfw) continue;
    const rank = officialRank(host, ch.website);
    if (rank === 0) continue;
    const feed = (s.feed && feedOf.get(`${s.channel}@${s.feed}`)) || mainFeed.get(s.channel);
    const key = `${ch.id}@${feed?.id ?? s.feed ?? "main"}`;
    const prev = best.get(key);
    if (prev && prev.rank >= rank) continue;
    const feedName = feed && !feed.is_main ? feed.name ?? feed.id : "";
    best.set(key, {
      rank,
      channel: {
        id: key,
        name: feedName ? `${ch.name} (${feedName})` : ch.name,
        url: s.url,
        website: ch.website ?? "",
        country: ch.country,
        languages: [...new Set((feed?.languages ?? []).map(iso1).filter((l): l is string => Boolean(l)))],
        categories: ch.categories,
        altNames: ch.alt_names ?? [],
      },
    });
  }
  return [...best.values()].map((b) => b.channel);
}

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Channels matching the language, country and name, news first, then by name. */
export function searchChannels(all: Channel[], q: TvQuery, limit = 300): Channel[] {
  const name = q.name ? fold(q.name) : "";
  const country = q.country?.toUpperCase();
  return all
    .filter((c) => !q.language || c.languages.includes(q.language))
    .filter((c) => !country || c.country === country)
    .filter((c) => !name || [c.name, ...(c.altNames ?? [])].some((n) => fold(n).includes(name)))
    .sort((a, b) => Number(b.categories.includes("news")) - Number(a.categories.includes("news")) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const DAY = 24 * 3600_000;
export function indexIsFresh(fetchedAt: number | null, now: number): boolean {
  return fetchedAt !== null && now - fetchedAt < DAY;
}

/** Bump when officialStreams changes, so an old cache is rebuilt. */
const CACHE_VERSION = 1;

interface Cached {
  version: number;
  fetchedAt: number;
  channels: Channel[];
}

export interface TvIndexDeps {
  /** Folder for the cache (in userData). */
  dir: string;
  fetchJson: (url: string) => Promise<unknown>;
  now: () => number;
}

function readCache(file: string): Cached | null {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8")) as Cached;
    return c.version === CACHE_VERSION && Array.isArray(c.channels) ? c : null;
  } catch {
    return null;
  }
}

/** After a failed refresh, the stale list is served and the next try waits this long. */
export const TV_RETRY_AFTER = 3600_000;

/** The official channels: from memory or the cache while under a day old, else downloaded.
 * A failed download serves an older list at once and backs off for an hour; with no list at all it rejects. */
export function createTvIndex(deps: TvIndexDeps): () => Promise<Channel[]> {
  const file = path.join(deps.dir, "tv-index.json");
  let memo: Cached | null = null;
  let pending: Promise<Channel[]> | null = null;
  let failedAt: number | null = null;
  let loaded = false;
  return () => {
    if (!loaded) {
      memo = readCache(file);
      loaded = true;
    }
    const now = deps.now();
    if (memo && indexIsFresh(memo.fetchedAt, now)) return Promise.resolve(memo.channels);
    if (memo && failedAt !== null && now - failedAt < TV_RETRY_AFTER) return Promise.resolve(memo.channels);
    pending ??= (async () => {
      try {
        const [streams, channels, feeds] = await Promise.all(["streams", "channels", "feeds"].map((n) => deps.fetchJson(`${IPTV_API}/${n}.json`)));
        if (!Array.isArray(streams) || !Array.isArray(channels) || !Array.isArray(feeds)) throw new Error("The channel list couldn't be read.");
        const next: Cached = { version: CACHE_VERSION, fetchedAt: deps.now(), channels: officialStreams(streams as IptvStream[], channels as IptvChannel[], feeds as IptvFeed[]) };
        fs.mkdirSync(deps.dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(next));
        memo = next;
        failedAt = null;
        return next.channels;
      } catch (err) {
        failedAt = deps.now();
        if (memo) return memo.channels;
        throw err instanceof Error && err.message.startsWith("The channel list") ? err : new Error("The channel list couldn't be downloaded. Check your connection and try again.");
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}
