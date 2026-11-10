// Readr's pages as addresses in its (in-memory) history. Every path is built here and read back here, so a page
// is never addressed by a hand-written string. Pure: the router (router.tsx) and the tests share it.

import { generatePath, matchPath } from "react-router";

export const LIST_NAMES = ["reading-list", "favorites", "archive"] as const;
export type ListName = (typeof LIST_NAMES)[number];
export type LiveKind = "radio" | "tv";

const isListName = (s: string | undefined): s is ListName => LIST_NAMES.includes(s as ListName);
const isLiveKind = (s: string | undefined): s is LiveKind => s === "radio" || s === "tv";

/** Which live page shows an article that is live: a channel's (tv), else a station's (radio). */
export const liveKindOf = (a: { kind?: string }): LiveKind => (a.kind === "tv" ? "tv" : "radio");

/** The router's patterns; `paths` builds them and `pageAt` reads them. */
export const PATTERNS = {
  home: "/home",
  review: "/review",
  cards: "/cards",
  list: "/list/:name",
  source: "/source/:sourceId",
  article: "/article/:articleId",
  live: "/live/:kind/:id",
  past: "/past/:sessionId",
  find: "/find/:kind",
  open: "/open",
} as const;

/** "?a=1&b=2" from the values that are set, "" when none is. */
function query(values: Record<string, string | undefined>): string {
  const q = new URLSearchParams(Object.entries(values).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return q ? `?${q}` : "";
}

export const paths = {
  home: () => PATTERNS.home,
  review: () => PATTERNS.review,
  cards: () => PATTERNS.cards,
  list: (name: ListName) => generatePath(PATTERNS.list, { name }),
  /** A source's page; `section` picks one of its followed sections (a feed id). */
  source: (sourceId: string, section?: string) => generatePath(PATTERNS.source, { sourceId }) + query({ section }),
  article: (articleId: string) => generatePath(PATTERNS.article, { articleId }),
  live: (kind: LiveKind, id: string) => generatePath(PATTERNS.live, { kind, id }),
  /** A past transcript, at the sentence a card came from; `url` is the station's address when known. */
  past: (sessionId: string, sentenceId?: string, url?: string) => generatePath(PATTERNS.past, { sessionId }) + query({ sentence: sentenceId, url }),
  /** Find stations or channels, starting on a language. */
  find: (kind: LiveKind, lang: string) => generatePath(PATTERNS.find, { kind }) + query({ lang }),
  /** Reading a page's address into an article (or a station): replaced by the article once it opens. */
  open: (url: string) => PATTERNS.open + query({ url }),
};

export type Page =
  | { page: "home" }
  | { page: "review" }
  | { page: "cards" }
  | { page: "list"; name: ListName }
  | { page: "source"; sourceId: string; section: string | undefined }
  | { page: "article"; articleId: string }
  | { page: "live"; kind: LiveKind; id: string }
  | { page: "past"; sessionId: string; sentenceId: string | undefined; url: string | undefined }
  | { page: "find"; kind: LiveKind; lang: string }
  | { page: "open"; url: string };

/** The page a location shows, or null for an address Readr doesn't have. `to` is a path with its query. */
export function pageAt(to: string): Page | null {
  const [raw, search = ""] = to.split("?");
  // Decoded segment by segment, as the router does: a "/" inside an id stays one segment.
  const pathname = raw.split("/").map((s) => decodeURIComponent(s).replace(/\//g, "%2F")).join("/");
  const q = new URLSearchParams(search);
  const at = (pattern: string) => matchPath(pattern, pathname)?.params;
  if (at(PATTERNS.home)) return { page: "home" };
  if (at(PATTERNS.review)) return { page: "review" };
  if (at(PATTERNS.cards)) return { page: "cards" };
  const list = at(PATTERNS.list);
  if (list) return isListName(list.name) ? { page: "list", name: list.name } : null;
  const source = at(PATTERNS.source);
  if (source?.sourceId) return { page: "source", sourceId: source.sourceId, section: q.get("section") ?? undefined };
  const article = at(PATTERNS.article);
  if (article?.articleId) return { page: "article", articleId: article.articleId };
  const live = at(PATTERNS.live);
  if (live) return isLiveKind(live.kind) && live.id ? { page: "live", kind: live.kind, id: live.id } : null;
  const past = at(PATTERNS.past);
  if (past?.sessionId) return { page: "past", sessionId: past.sessionId, sentenceId: q.get("sentence") ?? undefined, url: q.get("url") ?? undefined };
  const find = at(PATTERNS.find);
  if (find) return isLiveKind(find.kind) ? { page: "find", kind: find.kind, lang: q.get("lang") ?? "" } : null;
  if (at(PATTERNS.open) && q.get("url")) return { page: "open", url: q.get("url")! };
  return null;
}

/** The sidebar row a page selects ("home", "favorites", "feed:<id>", "radio-finder"…), or null for none. */
export function sidebarSelection(p: Page | null): string | null {
  switch (p?.page) {
    case "home":
    case "review":
    case "cards":
      return p.page;
    case "list":
      return p.name;
    case "source":
      return p.section ? `feed:${p.section}` : null;
    case "find":
      return p.kind === "radio" ? "radio-finder" : "tv-finder";
    default:
      return null;
  }
}

/** A source's address: its site's id when it has one, else its name (a source is named by its feeds). */
export const sourceIdOf = (sourceName: string, sites: { id: string; name: string }[]) => sites.find((s) => s.name === sourceName)?.id ?? sourceName;
/** The source an address names, back as the name its feeds carry. */
export const sourceNameOf = (sourceId: string, sites: { id: string; name: string }[]) => sites.find((s) => s.id === sourceId)?.name ?? sourceId;
