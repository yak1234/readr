// Typed ways to go to each page, over any navigate function. Going to the page already showing takes its place
// rather than adding an entry, so Back never seems to do nothing.

import { paths, type ListName, type LiveKind } from "./routes";

/** How a page is reached: `replace` takes the current entry's place (an article that finished opening);
 * `follow` scrolls the article to the sentence being read aloud. */
export interface GoOptions {
  replace?: boolean;
  follow?: boolean;
}

/** What a location carries besides its address. */
export interface LocationState {
  follow?: boolean;
}

type Navigate = (to: string | number, options?: { replace?: boolean; state?: LocationState }) => void;

export function navigator(navigate: Navigate, current: () => { pathname: string; search: string }) {
  const go = (to: string, o: GoOptions = {}) => {
    const here = current();
    const same = here.pathname + here.search === to;
    navigate(to, { replace: o.replace || same, state: o.follow ? { follow: true } : undefined });
  };
  return {
    toHome: () => go(paths.home()),
    toReview: () => go(paths.review()),
    toCards: () => go(paths.cards()),
    toList: (name: ListName) => go(paths.list(name)),
    toSource: (sourceId: string, section?: string) => go(paths.source(sourceId, section)),
    toArticle: (id: string, o?: GoOptions) => go(paths.article(id), o),
    toLive: (kind: LiveKind, id: string, o?: GoOptions) => go(paths.live(kind, id), o),
    toPast: (sessionId: string, sentenceId?: string, url?: string) => go(paths.past(sessionId, sentenceId, url)),
    toFind: (kind: LiveKind, lang: string) => go(paths.find(kind, lang)),
    toOpen: (url: string, o?: GoOptions) => go(paths.open(url), o),
    back: () => navigate(-1),
    forward: () => navigate(1),
  };
}
