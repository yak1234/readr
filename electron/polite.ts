// A quiet visitor: everything Readr asks of one site (its feeds, its pages, an article) goes through that
// site's own queue, one at a time with a short gap, so a page of a dozen sections never reaches the site as
// a burst. Different sites don't wait for each other. What the reader is waiting for (an article they
// opened) goes ahead of background loads.

import PQueue from "p-queue";
import { getDomain } from "tldts";

/** The pause between two requests to the same site. */
export const SITE_GAP_MS = 600;

export interface Politeness {
  /** Runs `task` when it is `url`'s site's turn. `urgent`: ahead of the tasks still waiting. */
  visit<T>(url: string, task: () => Promise<T>, options?: { urgent?: boolean }): Promise<T>;
}

/** The site a URL belongs to (www.lemonde.fr and journal.lemonde.fr are one site); the text itself when it isn't a URL. */
export function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname;
    return getDomain(host) ?? host;
  } catch {
    return url;
  }
}

export function createPoliteness(gapMs = SITE_GAP_MS): Politeness {
  const queues = new Map<string, PQueue>();
  return {
    visit<T>(url: string, task: () => Promise<T>, { urgent = false } = {}): Promise<T> {
      const site = siteOf(url);
      let queue = queues.get(site);
      if (!queue) {
        // One at a time, and at most one start per gap.
        queue = new PQueue({ concurrency: 1, interval: gapMs, intervalCap: 1 });
        queues.set(site, queue);
      }
      return queue.add(task, { priority: urgent ? 1 : 0 }) as Promise<T>;
    },
  };
}
