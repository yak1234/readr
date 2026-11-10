// RSS / Atom fetching through the logged-in session, with feed autodiscovery.

import type { Session } from "electron";
import { XMLParser } from "fast-xml-parser";
import type { Feed, FeedItem } from "../shared/types";
import { isHttpUrl } from "../shared/live";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

const discovered = new Map<string, string>();

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
};
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à",
  acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë", laquo: "«", raquo: "»",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", ndash: "–", mdash: "—", oelig: "œ",
};
/** Decode HTML entities; feeds often escape twice (&amp;quot;), so repeat. */
function decodeEntities(s: string): string {
  let prev = "";
  for (let i = 0; i < 3 && prev !== s; i++) {
    prev = s;
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  }
  return s;
}
const stripHtml = (s: string) => decodeEntities(decodeEntities(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

type XmlNode = Record<string, any>;
/** A media element that is a picture: said so by its medium or type, or saying nothing either way. */
const isPicture = (m: XmlNode) => (m["@_medium"] ? m["@_medium"] === "image" : m["@_type"] ? /^image\//i.test(m["@_type"]) : true);
const pictureUrl = (nodes: XmlNode[], attr = "@_url"): string => nodes.find((m) => m?.[attr] && isPicture(m))?.[attr] ?? "";

/** An item's picture, from Media RSS (media:content, then media:thumbnail, either one inside a media:group too) or an image enclosure
 * (RSS <enclosure>, Atom <link rel="enclosure">). An enclosure must say it is an image: podcasts carry audio. */
function imageOf(it: XmlNode): string {
  const groups = asArray<XmlNode>(it["media:group"]);
  const media = [...asArray<XmlNode>(it["media:content"]), ...groups.flatMap((g) => asArray<XmlNode>(g["media:content"]))];
  const thumbnails = [...asArray<XmlNode>(it["media:thumbnail"]), ...groups.flatMap((g) => asArray<XmlNode>(g["media:thumbnail"]))];
  const enclosures = asArray<XmlNode>(it.enclosure).filter((e) => /^image\//i.test(e["@_type"] ?? ""));
  const atomEnclosures = asArray<XmlNode>(it.link).filter((l) => l["@_rel"] === "enclosure" && /^image\//i.test(l["@_type"] ?? ""));
  return pictureUrl(media) || pictureUrl(thumbnails) || pictureUrl(enclosures) || pictureUrl(atomEnclosures, "@_href");
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    return asArray(doc.rss.channel.item).map((it: XmlNode) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link) || text(it.guid),
      date: text(it.pubDate) || text(it["dc:date"]),
      description: stripHtml(text(it.description)),
      imageUrl: imageOf(it),
    }));
  }
  if (doc.feed?.entry) {
    return asArray(doc.feed.entry).map((it: XmlNode) => {
      const links = asArray(it.link);
      const alt = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      return {
        title: stripHtml(text(it.title)),
        link: alt?.["@_href"] ?? "",
        date: text(it.published) || text(it.updated),
        description: stripHtml(text(it.summary) || text(it.content)),
        imageUrl: imageOf(it),
      };
    });
  }
  return [];
}

/** How long loading one feed may take, all of it: the renderer fetches a few feeds at a time through one shared
 * queue, so a feed that never answers must end, or three of them would stall every feed (Home included). */
export const FEED_TIMEOUT_MS = 15_000;

const TOO_SLOW = "The site took too long to answer.";

async function discoverFeedUrl(homepage: string, session: Session, signal: AbortSignal): Promise<string> {
  const cached = discovered.get(homepage);
  if (cached) return cached;
  const html = await (await session.fetch(homepage, { signal })).text();
  const tag = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
  const href = tag?.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) throw new Error("No RSS feed advertised on the homepage.");
  const url = new URL(href, homepage).toString();
  if (!isHttpUrl(url)) throw new Error("Feed address must be http(s).");
  discovered.set(homepage, url);
  return url;
}

/** Path segments that mark section, tag, author or account pages, not articles. */
const NOT_ARTICLE = /^(tag|tags|auteur|auteurs|author|authors|categorie|category|rubrique|section|sections|abonnement|subscribe|login|connexion|compte|account|newsletter|newsletters|podcasts?|video|videos|search|recherche)$/i;

/** Article links on a homepage, for sites without RSS: same host, and a path
 * that looks like an article (a numeric id, a date, or at least three
 * segments), first occurrence only. */
export function homepageItems(html: string, base: string): FeedItem[] {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(m[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, "") !== host) continue;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0 || NOT_ARTICLE.test(segments[0])) continue;
    const looksLikeArticle = /\d{4,}/.test(url.pathname) || /\/20\d\d\/\d\d\//.test(url.pathname) || segments.length >= 3;
    if (!looksLikeArticle) continue;
    url.hash = "";
    const link = url.toString();
    const title = stripHtml(m[2]).replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
    if (seen.has(link) || title.split(" ").length < 4) continue;
    seen.add(link);
    const img = m[2].match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1];
    items.push({ title, link, date: "", description: "", imageUrl: img ? new URL(img, base).toString() : "" });
    if (items.length >= 40) break;
  }
  return items;
}

/** Load a page as the user would (handles sites that block plain requests). The signal ends the load. */
export type PageLoader = (url: string, signal: AbortSignal) => Promise<string>;

/** One deadline for the whole load of a feed (every request of it, and a homepage load): past it the feed fails with
 * a plain message and whatever is still running is told to stop. */
export async function fetchFeed(feed: Feed, session: Session, loadPage?: PageLoader, timeoutMs = FEED_TIMEOUT_MS): Promise<FeedItem[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  const deadline = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error(TOO_SLOW)), { once: true }));
  const load = async (): Promise<FeedItem[]> => {
    if (feed.fromHomepage) {
      if (!loadPage) throw new Error("This source needs a page loader.");
      return homepageItems(await loadPage(feed.homepage, signal), feed.homepage);
    }
    if (feed.url && !isHttpUrl(feed.url)) throw new Error("Feed address must be http(s).");
    const get = async (address: string) => {
      const res = await session.fetch(address, { signal });
      return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : "" };
    };
    let res = await get(feed.url || (await discoverFeedUrl(feed.homepage, session, signal)));
    if (!res.ok && feed.url) {
      // Hard-coded URL moved: fall back to autodiscovery.
      res = await get(await discoverFeedUrl(feed.homepage, session, signal));
    }
    if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}.`);
    return parseFeed(res.body).filter((i) => i.title && i.link);
  };
  const loading = load();
  loading.catch(() => undefined); // if the deadline wins, the loser's own rejection is not unhandled
  try {
    return await Promise.race([loading, deadline]);
  } catch (err) {
    // Whatever it was rejected with (an abort, a timeout, the deadline), it ran out of time.
    throw signal.aborted ? new Error(TOO_SLOW) : err;
  }
}
