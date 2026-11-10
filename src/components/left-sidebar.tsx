// The left panel: Readr's pages, the language's sources (each opens its newspaper page; its followed sections
// open that page at the section), TV channels and radio stations. Every row is a link through the router; what
// is selected is read from the page showing. Lists of stories live in the main column, never here.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, BookOpen, Bookmark, GalleryVerticalEnd, Home, KeyRound, Layers, Newspaper, Plus, Radio, Search, Tv, X, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { useCachedArticle } from "../lib/article-cache";
import { useLanguageScope } from "../lib/language-scope";
import { toReview } from "../lib/review-counts";
import { countRender } from "../lib/store";
import { useLanguage } from "../shell/language-provider";
import { useLibrary } from "../shell/library-provider";
import { usePage, useReadrNavigate } from "../shell/navigation";
import { useOpen } from "../shell/open-actions";
import { sidebarSelection, sourceIdOf } from "../shell/routes";
import { useReadrSettings } from "../shell/settings-provider";
import { useStudy } from "../shell/study-provider";
import { AddSource } from "./add-source";
import { ImportLogins } from "./import-logins";
import { GroupLabel } from "./article-list";

/** The panel's width (the title bar's left end lines up with it). */
export const LEFT_W = 220;

const navItems = [
  { id: "review", label: "nav.review", icon: GalleryVerticalEnd },
  { id: "home", label: "nav.home", icon: Home },
  { id: "reading-list", label: "nav.readingList", icon: BookOpen },
  { id: "favorites", label: "nav.favorites", icon: Bookmark },
  { id: "archive", label: "nav.archive", icon: Archive },
  { id: "cards", label: "nav.cards", icon: Layers },
] as const;

export function LeftSidebar() {
  countRender("Sidebar");
  const { t } = useTranslation();
  const scope = useLanguageScope();
  const { c } = useReadrSettings();
  const { feeds, sites, refreshSources, stations, removeStation, channels, removeChannel } = useLibrary();
  const { lang } = useLanguage();
  const { cardCount, counts } = useStudy();
  const nav = useReadrNavigate();
  const { openUrl } = useOpen();
  const page = usePage();
  const selection = sidebarSelection(page);
  const shownUrl = useCachedArticle(page?.page === "article" ? page.articleId : null)?.url ?? null;
  const selectedUrl = page?.page === "open" ? page.url : shownUrl;
  const [adding, setAdding] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");

  const submitUrl = () => {
    const url = draftUrl.trim();
    if (/^https?:\/\//.test(url)) {
      openUrl(url);
      setDraftUrl("");
      setAdding(false);
    }
  };

  const go = (id: (typeof navItems)[number]["id"]) => (id === "home" ? nav.toHome() : id === "review" ? nav.toReview() : id === "cards" ? nav.toCards() : nav.toList(id));
  /** A row: a page of the app, or a followed section (its name is content: `dir="auto"`). */
  const navButton = (id: string, label: string, Icon: LucideIcon, onClick: () => void, badge?: number) => (
    <button
      key={id}
      data-nav={id}
      onClick={onClick}
      className="readr-hover"
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 16px", fontSize: 13, fontWeight: selection === id ? 500 : 400, color: selection === id ? c.text : c.body, background: selection === id ? c.selected : "transparent", border: "none", cursor: "pointer", textAlign: "start", ["--hover" as string]: c.hover }}
    >
      <Icon size={14} strokeWidth={1.8} />
      <span dir="auto" style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {badge ? <span data-badge={badge} style={{ fontSize: 10, color: c.muted }}>{badge}</span> : null}
    </button>
  );

  const userSiteBySource = new Map(sites.filter((s) => s.user).map((s) => [s.name, s]));
  const langFeeds = feeds.filter((f) => f.lang === lang);
  /** Whether the page showing is this source's own (not one of its sections). */
  const onSource = (source: string) => page?.page === "source" && !page.section && page.sourceId === sourceIdOf(source, sites);
  /** The language's sources (one with every section unticked still listed), each with its followed sections. */
  const feedsBySource = (Icon: LucideIcon) =>
    scope.sourceNames.map((source) => {
      const userSite = userSiteBySource.get(source);
      return (
        <div key={source} className="readr-source">
          <GroupLabel c={c}>
            <button
              data-source-name={source}
              dir="auto"
              aria-current={onSource(source) ? "page" : undefined}
              title={t("sidebar.openSource", { name: source })}
              onClick={() => nav.toSource(sourceIdOf(source, sites))}
              style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", letterSpacing: "inherit", textTransform: "inherit", color: onSource(source) ? c.text : "inherit" }}
            >
              {source}
            </button>
            {userSite && (
              <button title={t("sidebar.remove", { name: source })} className="readr-source-remove" onClick={() => api.removeSource(userSite.id).then(refreshSources)} style={{ background: "none", border: "none", color: c.muted, cursor: "pointer", padding: 0, display: "flex" }}>
                <X size={11} />
              </button>
            )}
          </GroupLabel>
          {langFeeds.filter((f) => f.source === source).map((f) => navButton(`feed:${f.id}`, f.name, Icon, () => nav.toSource(sourceIdOf(source, sites), f.id)))}
        </div>
      );
    });

  /** A saved station or channel: opens it; the cross removes it. */
  const liveRow = (item: { id: string; name: string; url: string }, Icon: LucideIcon, onRemove: (id: string) => void) => {
    const on = (page?.page === "live" && page.id === item.id) || selectedUrl === item.url;
    return (
      <div key={item.id} className="readr-source">
        <button
          onClick={() => openUrl(item.url)}
          className="readr-hover"
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 16px", fontSize: 13, fontWeight: on ? 500 : 400, color: on ? c.text : c.body, background: on ? c.selected : "transparent", border: "none", cursor: "pointer", textAlign: "start", ["--hover" as string]: c.hover }}
        >
          <Icon size={14} strokeWidth={1.8} style={{ flexShrink: 0 }} />
          <span dir="auto" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{item.name}</span>
          <span
            role="button"
            title={t("sidebar.remove", { name: item.name })}
            className="readr-source-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            style={{ color: c.muted, display: "flex" }}
          >
            <X size={11} />
          </span>
        </button>
      </div>
    );
  };
  const findButton = (attr: string, label: string, on: boolean, onClick: () => void) => (
    <button {...{ [attr]: "" }} onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 16px", fontSize: 11, color: on ? c.text : c.muted, background: "none", border: "none", cursor: "pointer" }}>
      <Search size={11} strokeWidth={2} />
      {label}
    </button>
  );
  const groupHeading = (label: string, Icon: LucideIcon) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px 4px", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: c.muted }}>
      <Icon size={11} strokeWidth={2} />
      {label}
    </div>
  );

  return (
    <>
      <aside data-sidebar className="readr-no-select" style={{ width: LEFT_W, minWidth: LEFT_W, display: "flex", flexDirection: "column", height: "100%", background: c.panel, borderRight: `1px solid ${c.border}`, fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${c.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.3px", color: c.text }}>{t("app.name")}</div>
        </div>

        <nav style={{ padding: "8px 0" }}>
          {navItems.map(({ id, label, icon }) => navButton(id, t(label), icon, () => go(id), id === "cards" ? cardCount : id === "review" ? toReview(counts) : undefined))}
        </nav>

        <div style={{ height: 1, background: c.border, margin: "4px 0" }} />

        {lang ? (
          <nav data-lang-lists dir="ltr" style={{ flex: 1, minHeight: 0, padding: "0 0 8px", overflowY: "auto" }}>
            <div data-group="articles">
              {groupHeading(t("sidebar.articles"), Newspaper)}
              {feedsBySource(Newspaper)}
              <AddSource
                key={lang}
                lang={lang}
                trigger={
                  <button data-add-source style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 16px", fontSize: 11, color: c.muted, background: "none", border: "none", cursor: "pointer" }}>
                    <Plus size={11} strokeWidth={2} />
                    {t("sources.add")}
                  </button>
                }
                onAdded={async (id) => {
                  await refreshSources(); // the page looks the source up among the library's
                  nav.toSource(id);
                }}
              />
            </div>
            <div data-group="tv">
              {groupHeading(t("sidebar.liveTv"), Tv)}
              {channels.filter((ch) => ch.lang === lang).map((ch) => liveRow(ch, Tv, removeChannel))}
              {findButton("data-find-channels", t("sidebar.findChannels"), selection === "tv-finder", () => nav.toFind("tv", lang))}
            </div>
            <div data-group="live">
              {groupHeading(t("sidebar.radio"), Radio)}
              {stations.filter((st) => st.lang === lang).map((st) => liveRow(st, Radio, removeStation))}
              {findButton("data-find-stations", t("sidebar.findStations"), selection === "radio-finder", () => nav.toFind("radio", lang))}
            </div>
          </nav>
        ) : (
          <div style={{ flex: 1 }} />
        )}

        <div style={{ padding: "10px 16px 12px", borderTop: `1px solid ${c.border}` }}>
          <ImportLogins
            trigger={
              <button data-import-logins-link style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.muted, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
                <KeyRound size={13} strokeWidth={2} />
                {t("panel.importLogins")}
              </button>
            }
          />
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitUrl();
              }}
            >
              <input
                autoFocus
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onBlur={() => !draftUrl && setAdding(false)}
                onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                placeholder={t("sidebar.pasteLink")}
                style={{ width: "100%", padding: "6px 8px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.text, outline: "none", fontFamily: "inherit" }}
              />
            </form>
          ) : (
            <button onClick={() => setAdding(true)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.muted, background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}>
              <Plus size={13} strokeWidth={2} />
              {t("sidebar.addArticle")}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

