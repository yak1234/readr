// The article the current page shows, resolved from its address: an article (from this session's cache, the
// read-aloud session, or the library), a station's live transcript (only while that station is the one
// selected: going Back to it never starts it), or a past transcript (from the live history).

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import type { Article } from "../../shared/types";
import { api } from "../lib/api";
import { articleCache, useCachedArticle } from "../lib/article-cache";
import { pastTranscriptArticle } from "../lib/past-transcript";
import { radioStore } from "../lib/radio-session";
import { useReader } from "./reader-provider";
import { usePage } from "./navigation";
import type { Page } from "./routes";

export interface ShownArticle {
  page: Page | null;
  /** What is shown, once it is known. */
  article: Article | null;
  /** "missing": the address names something that can't be shown (a deleted article, a station not playing). */
  status: "none" | "loading" | "ready" | "missing";
}

/** The id an article or past transcript is cached under. */
const cacheId = (page: Page | null) => (page?.page === "article" ? page.articleId : page?.page === "past" ? `past:${page.sessionId}` : null);

export function useShownArticle(): ShownArticle {
  const location = useLocation();
  const page = usePage();
  const reader = useReader();
  // The station's transcript only matters on its page: elsewhere its new sentences redraw nothing.
  const onLive = page?.page === "live";
  const radioArticle = useSyncExternalStore(radioStore.subscribe, () => (onLive ? radioStore.get().article : null));
  const id = cacheId(page);
  const cached = useCachedArticle(id);
  const known = cached ?? (reader.article?.id === id ? reader.article : undefined);
  const [missing, setMissing] = useState<string | null>(null);

  // An article not opened this session comes from the library. A past transcript is read again each time it is
  // visited (the session it belongs to may still be growing); its cached copy shows meanwhile.
  const pastUrl = page?.page === "past" ? page.url : undefined;
  const fetchKey = page?.page === "past" ? location.key : known ? null : id;
  useEffect(() => {
    if (!fetchKey || !id || !page) return;
    let cancelled = false;
    const found = (a: Article | null) => {
      if (cancelled) return;
      if (a) articleCache.remember(a);
      else setMissing(id);
    };
    if (page.page === "past") api.liveTranscript(page.sessionId).then((t) => found(t && pastTranscriptArticle(t.session, t.sentences, pastUrl)), () => found(null));
    else api.getArticle(id).then(found, () => found(null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  if (page?.page === "live") {
    const live = radioArticle && radioArticle.kind === page.kind && radioArticle.id === page.id ? radioArticle : null;
    return { page, article: live, status: live ? "ready" : "missing" };
  }
  if (!id) return { page, article: null, status: "none" };
  if (known) return { page, article: known, status: "ready" };
  return { page, article: null, status: missing === id ? "missing" : "loading" };
}
