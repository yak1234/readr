// A source's newspaper page as a model: one block per followed section, in the order the reader follows them,
// each led by its newest story with a picture. A story in two sections is shown once, in the first, so a section
// waits for those above it: nothing appears and then moves away, or pushes what is being read down the page.
// Pure: the source page lays it out and the tests check it.

import type { Feed, Lang } from "../../shared/types";
import { byNewest, toStory, type FeedState, type Story } from "./stories";

/** A followed section and what its feed holds (undefined: not fetched yet). */
export interface SourceFeed {
  feed: Feed;
  state: FeedState | undefined;
}

/** A section's heading: its own name (content, in the source's language), or "Latest" for a source that offers
 * a single feed (whose name is only ever a generic "News"). */
export type SectionHeading = { kind: "named"; name: string } | { kind: "latest" };

/** Loading: nothing to show yet. Failed: the fetch failed with nothing kept. Ready: its stories (maybe none). */
export type SectionStatus = "loading" | "failed" | "ready";

export interface PageSection {
  /** The section's feed, to fetch it again and to scroll to it. */
  feedId: string;
  lang: Lang;
  heading: SectionHeading;
  status: SectionStatus;
  error?: string;
  /** Its newest story with a picture, else its newest; null when it has none. */
  lead: Story | null;
  /** The rest, newest first. */
  items: Story[];
}

export interface SourcePageModel {
  sections: PageSection[];
}

function statusOf(state: FeedState | undefined): SectionStatus {
  if (!state || (state.loading && state.items.length === 0)) return "loading";
  return state.error && state.items.length === 0 ? "failed" : "ready";
}

/** `offered`: how many sections the source offers in all (its catalogue), undefined while that isn't known. */
export function sourcePage(feeds: SourceFeed[], now: number, offered: number | undefined): SourcePageModel {
  const shown = new Set<string>();
  let above: SectionStatus = "ready";
  const sections = feeds.map(({ feed, state }): PageSection => {
    const heading: SectionHeading = offered === 1 && feeds.length === 1 ? { kind: "latest" } : { kind: "named", name: feed.name };
    // Held while a section above is still loading: what it shows decides what this one shows.
    if (above === "loading") return { feedId: feed.id, lang: feed.lang, heading, status: "loading", lead: null, items: [] };
    const status = statusOf(state);
    above = status;
    const stories: Story[] = [];
    for (const it of state?.items ?? []) {
      if (shown.has(it.link)) continue;
      shown.add(it.link);
      stories.push(toStory(it, feed, now));
    }
    stories.sort(byNewest);
    const lead = stories.find((s) => s.imageUrl) ?? stories[0] ?? null;
    return {
      feedId: feed.id,
      lang: feed.lang,
      heading,
      status,
      ...(status === "failed" ? { error: state?.error } : {}),
      lead,
      items: stories.filter((s) => s !== lead),
    };
  });
  return { sections };
}
