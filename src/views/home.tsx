// /home — the front page across the language's sources.

import { useMemo } from "react";
import { HomeView } from "../components/home-view";
import { useLanguage } from "../shell/language-provider";
import { useFeedStories, useLibrary, useLoadFeeds } from "../shell/library-provider";
import { useOpen } from "../shell/open-actions";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";

export function HomePage() {
  const { c, tokens, dark } = useReadrSettings();
  const { ready, feeds, refreshSources } = useLibrary();
  const { feedState } = useFeedStories();
  const { lang } = useLanguage();
  const { openUrl } = useOpen();
  // The language's own feeds: Home is one language at a time.
  const own = useMemo(() => feeds.filter((f) => f.lang === lang), [feeds, lang]);
  useLoadFeeds(own);
  useScrollRestore(ready && Boolean(lang));
  if (!ready || !lang) return <div />;
  return <HomeView c={c} tokens={tokens} dark={dark} feeds={own} feedState={feedState} onOpenUrl={openUrl} onSourcesChanged={refreshSources} />;
}
