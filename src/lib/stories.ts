// A feed's stories as the pages show them: what a feed holds while it loads, and each story with its source,
// its language and when it was published. Pure: Home, the source pages and the tests share it.

import type { Feed, FeedItem, Lang } from "../../shared/types";

/** A followed feed's fetch: its stories (kept through a refresh), the error of the last fetch if it failed, and
 * when the last fetch ended (ms; absent until one has). */
export interface FeedState {
  loading: boolean;
  items: FeedItem[];
  error?: string;
  fetchedAt?: number;
}

/** How long a feed's stories stand before a page showing them fetches them again. */
export const STALE_AFTER_MS = 15 * 60_000;

/** Fetched long enough ago to fetch again (one being fetched never is). */
export const isStale = (state: FeedState, now: number) => !state.loading && now - (state.fetchedAt ?? 0) > STALE_AFTER_MS;

/** The feeds a page should fetch as it shows: never fetched, or stale. Their stories stay up while they load. */
export const feedsToLoad = (feeds: Feed[], states: Record<string, FeedState | undefined>, now: number): string[] =>
  feeds.filter((f) => {
    const state = states[f.id];
    return !state || isStale(state, now);
  }).map((f) => f.id);

/** A feed item placed: whose it is, in which language, and when (ms; 0 when the feed doesn't say). */
export interface Story extends FeedItem {
  source: string;
  lang: Lang;
  time: number;
}

/** A feed's item as a story. A date after `now` (a clock or a feed gone wrong) counts as now, so a story can't
 * stay on top by claiming to come from tomorrow. */
export function toStory(item: FeedItem, feed: Feed, now: number): Story {
  const parsed = Date.parse(item.date);
  return { ...item, source: feed.source, lang: feed.lang, time: Number.isNaN(parsed) ? 0 : Math.min(parsed, now) };
}

/** Newest first; stories without a date keep their feed's order, after the dated ones. */
export const byNewest = (a: Story, b: Story) => b.time - a.time;
