// /source/:sourceId?section= — a source's newspaper page: every followed section, in the reader's order. With a
// section, the page opens scrolled to it (the sidebar's section rows and the page's own index link here).

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Notice } from "../components/notice";
import { SectionPicker } from "../components/section-picker";
import { api } from "../lib/api";
import { sourcePage } from "../lib/source-page";
import { useFeedStories, useLibrary, useLoadFeeds } from "../shell/library-provider";
import { usePage, useReadrNavigate } from "../shell/navigation";
import { useOpen } from "../shell/open-actions";
import { sourceNameOf } from "../shell/routes";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import { SourceView } from "./source-view";

export function SourcePage() {
  const { t } = useTranslation();
  const { c, tokens } = useReadrSettings();
  const { feeds, sites, ready, refreshSources } = useLibrary();
  const { feedState, loadFeed } = useFeedStories();
  const { openUrl } = useOpen();
  const nav = useReadrNavigate();
  const page = usePage();
  const [picking, setPicking] = useState(false);
  const sourceId = page?.page === "source" ? page.sourceId : "";
  const section = page?.page === "source" ? page.section : undefined;
  const name = sourceNameOf(sourceId, sites);
  const site = sites.find((s) => s.name === name);
  const own = useMemo(() => feeds.filter((f) => f.source === name), [feeds, name]);

  useLoadFeeds(own);
  const refresh = () => own.filter((f) => !feedState[f.id]?.loading).forEach((f) => loadFeed(f.id));
  const refreshing = own.some((f) => feedState[f.id]?.loading);

  // How many sections the source offers in all: one, and its section is simply "Latest".
  const [offered, setOffered] = useState<{ sourceId: string; count: number } | null>(null);
  const siteId = site?.id;
  useEffect(() => {
    if (!siteId) return;
    let live = true;
    api.sourceSections(siteId).then((r) => live && setOffered({ sourceId: siteId, count: r.sections.length }), () => undefined);
    return () => {
      live = false;
    };
  }, [siteId]);
  const offeredCount = offered?.sourceId === siteId ? offered?.count : undefined;

  const model = useMemo(() => sourcePage(own.map((feed) => ({ feed, state: feedState[feed.id] })), Date.now(), offeredCount), [own, feedState, offeredCount]);
  // Laid out once the sections above the one to show (all of them, to come Back to a place) have their stories.
  const upTo = section ? model.sections.findIndex((s) => s.feedId === section) : -1;
  const settled = model.sections.slice(0, upTo < 0 ? undefined : upTo + 1).every((s) => s.status !== "loading");
  useScrollRestore(ready && settled, (main) => {
    const target = section ? main.querySelector(`[data-source-section="${CSS.escape(section)}"]`) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else main.scrollTop = 0;
  });

  if (!ready || page?.page !== "source") return null;
  if (!site) return <Notice tokens={tokens} title={t("sourcePage.missing")} />;
  return (
    <>
      {picking && <SectionPicker c={c} sourceId={site.id} sourceName={site.name} onClose={() => setPicking(false)} onSaved={refreshSources} />}
      <SourceView
        c={c}
        tokens={tokens}
        name={site.name}
        lang={site.lang}
        model={model}
        current={section}
        onOpenStory={openUrl}
        onOpenSection={(feedId) => nav.toSource(sourceId, feedId)}
        onRetry={loadFeed}
        onChooseSections={() => setPicking(true)}
        onRefresh={refresh}
        refreshing={refreshing}
      />
    </>
  );
}
