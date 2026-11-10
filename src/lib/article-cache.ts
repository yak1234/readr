// The articles opened this session, by id, so going Back to one shows it at once. The library (getArticle)
// remains the record; this only spares asking it again. A handful are kept, the least recently opened go first.

import { useSyncExternalStore } from "react";
import type { Article } from "../../shared/types";
import { createStore } from "./store";

const KEEP = 40;

export function createArticleCache(keep = KEEP) {
  const store = createStore<ReadonlyMap<string, Article>>(new Map());
  return {
    get: (id: string) => store.get().get(id),
    subscribe: store.subscribe,
    /** Keeps `article` (replacing an older copy), as the most recent. */
    remember(article: Article) {
      const next = new Map(store.get());
      next.delete(article.id);
      next.set(article.id, article);
      for (const id of next.keys()) {
        if (next.size <= keep) break;
        next.delete(id);
      }
      store.set(next);
    },
    /** Drops the article (it was deleted): Back to it asks the library, which says it is gone. */
    forget(id: string) {
      if (!store.get().has(id)) return;
      const next = new Map(store.get());
      next.delete(id);
      store.set(next);
    },
  };
}

export const articleCache = createArticleCache();

/** The cached article with this id, kept up to date (undefined when it isn't cached). */
export function useCachedArticle(id: string | null): Article | undefined {
  return useSyncExternalStore(articleCache.subscribe, () => (id ? articleCache.get(id) : undefined));
}
