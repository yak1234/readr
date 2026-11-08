// RSS / Atom fetching through the logged-in session, with feed autodiscovery.

import type { Session } from "electron";
import { XMLParser } from "fast-xml-parser";
import type { Feed, FeedItem } from "../shared/types";

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
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  if (doc.rss?.channel) {
    return asArray(doc.rss.channel.item).map((it: Record<string, any>) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link) || text(it.guid),
      date: text(it.pubDate) || text(it["dc:date"]),
      description: stripHtml(text(it.description)),
      imageUrl:
        asArray(it["media:content"])[0]?.["@_url"] ??
        asArray(it["media:thumbnail"])[0]?.["@_url"] ??
        asArray(it.enclosure)[0]?.["@_url"] ??
        "",
    }));
  }
  if (doc.feed?.entry) {
    return asArray(doc.feed.entry).map((it: Record<string, any>) => {
      const links = asArray(it.link);
      const alt = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      return {
        title: stripHtml(text(it.title)),
        link: alt?.["@_href"] ?? "",
        date: text(it.updated) || text(it.published),
        description: stripHtml(text(it.summary) || text(it.content)),
        imageUrl: asArray(it["media:thumbnail"])[0]?.["@_url"] ?? "",
      };
    });
  }
  return [];
}

async function discoverFeedUrl(homepage: string, session: Session): Promise<string> {
  const cached = discovered.get(homepage);
  if (cached) return cached;
  const res = await session.fetch(homepage);
  const html = await res.text();
  const tag = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
  const href = tag?.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) throw new Error("No RSS feed advertised on the homepage.");
  const url = new URL(href, homepage).toString();
  discovered.set(homepage, url);
  return url;
}

export async function fetchFeed(feed: Feed, session: Session): Promise<FeedItem[]> {
  const url = feed.url || (await discoverFeedUrl(feed.homepage, session));
  let res = await session.fetch(url);
  if (!res.ok && feed.url) {
    // Hard-coded URL moved: fall back to autodiscovery.
    res = await session.fetch(await discoverFeedUrl(feed.homepage, session));
  }
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}.`);
  return parseFeed(await res.text()).filter((i) => i.title && i.link);
}
