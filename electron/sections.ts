// Sections: the feeds a source offers, and which of them the reader follows.
// Built-in sources list theirs by hand (electron/sites.ts); sources the user
// added are discovered from their pages' <link rel="alternate"> tags.

import crypto from "node:crypto";
import { mergeSources } from "./sources";
import { isHttpUrl } from "../shared/live";
import { SECTIONS } from "./sites";
import type { Feed, Section, Site, UserSource } from "../shared/types";

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);

export function builtInSections(siteId: string): Section[] {
  return SECTIONS[siteId] ?? [];
}

/** RSS/Atom links advertised by a page, resolved against `baseUrl` and deduped. */
export function discoverSections(html: string, baseUrl: string): Section[] {
  const out: Section[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((v) => v !== undefined);
    if (!/\balternate\b/i.test(attr("rel") ?? "") || !/^application\/(rss|atom)\+xml$/i.test((attr("type") ?? "").trim())) continue;
    const href = attr("href");
    if (!href) continue;
    let url: string;
    try {
      url = new URL(decode(href), baseUrl).toString();
    } catch {
      continue;
    }
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const fromUrl = new URL(url).pathname.split("/").filter((p) => p && !/^(rss|feed|atom|index)(\.\w+)?$/i.test(p)).pop()?.replace(/\.\w+$/, "").replace(/[-_]+/g, " ");
    out.push({ id: `s-${hash(url)}`, name: decode(attr("title") ?? "") || fromUrl || new URL(url).hostname, url });
  }
  return out;
}

/** The homepage's feeds, plus those on a few of its section pages (single-segment links). */
export async function discoverFromSite(homepage: string, loadHtml: (url: string) => Promise<string>, fetchHtml: (url: string) => Promise<string> = fetchText): Promise<Section[]> {
  const html = await loadHtml(homepage);
  const found = discoverSections(html, homepage);
  const host = new URL(homepage).hostname;
  const pages = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\shref=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(decode(m[1]), homepage);
      if (u.hostname === host && /^\/[a-z0-9-]+\/?$/i.test(u.pathname) && !u.search) pages.add(u.origin + u.pathname);
    } catch { /* not a link */ }
    if (pages.size >= 8) break;
  }
  const more = await Promise.all([...pages].map((p) => fetchHtml(p).then((h) => discoverSections(h, p)).catch(() => [])));
  const seen = new Set(found.map((s) => s.url));
  for (const s of more.flat()) if (!seen.has(s.url)) { seen.add(s.url); found.push(s); }
  return found;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  return res.ok ? await res.text() : "";
}

/** The sections an added source offers: its own feeds first, then discovered ones. */
function userSections(u: UserSource, discovered: Section[] = []): Section[] {
  const own = u.feeds.map((f, i) => ({ id: `${u.id}-${i}`, name: f.name, url: f.url }));
  const urls = new Set(own.map((s) => s.url).filter(Boolean));
  const seen = new Set(own.map((s) => s.id));
  const extra: Section[] = [];
  for (const s of discovered) {
    const id = s.id.startsWith(`${u.id}-`) ? s.id : `${u.id}-${s.id}`; // persisted ones are already prefixed
    if (urls.has(s.url) || seen.has(id)) continue;
    seen.add(id);
    extra.push({ ...s, id });
  }
  return [...own, ...extra];
}

export interface SectionDeps {
  user: UserSource[];
  cache: Record<string, Section[]>;
  saveCache: (sourceId: string, sections: Section[]) => void;
  discover: (homepage: string) => Promise<Section[]>;
}

export async function sectionsFor(sourceId: string, deps: SectionDeps): Promise<Section[]> {
  const builtIn = builtInSections(sourceId);
  if (builtIn.length) return builtIn;
  const u = deps.user.find((s) => s.id === sourceId);
  if (!u) return [];
  let discovered = deps.cache[sourceId];
  if (!discovered) {
    try {
      discovered = await deps.discover(u.homepage);
      deps.saveCache(sourceId, discovered);
    } catch {
      discovered = []; // not cached: try again next time
    }
  }
  return userSections(u, discovered);
}

/** The feeds to show: a source's defaults until the reader picks sections, then exactly those, in picker order. */
export function activeFeeds(
  sites: Site[],
  feeds: Feed[],
  user: UserSource[],
  followedOf: (sourceId: string) => string[] | null,
  cache: Record<string, Section[]>,
): Feed[] {
  const merged = mergeSources(sites, feeds, user);
  const userById = new Map(user.map((u) => [u.id, u]));
  return merged.sites.flatMap((site) => {
    const own = merged.feeds.filter((f) => f.source === site.name);
    const followed = followedOf(site.id);
    if (!followed) return own;
    const u = userById.get(site.id);
    const sections = u ? userSections(u, cache[site.id]) : builtInSections(site.id);
    const chosen = sections.filter((s) => followed.includes(s.id));
    // Nothing followed can be resolved (lost cache, removed section): show the defaults, not nothing.
    if (followed.length > 0 && chosen.length === 0) return own;
    return chosen
      .map((s): Feed => own.find((f) => f.id === s.id) ?? { id: s.id, name: s.name, source: site.name, url: s.url, homepage: site.homepage, lang: site.lang, fromHomepage: !s.url });
  });
}
