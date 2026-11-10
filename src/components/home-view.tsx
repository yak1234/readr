import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Feed } from "../../shared/types";
import { SERIF, UI_FONT, type ChromeTokens, type ReadingTokens } from "../lib/theme";
import { languageScope, useLanguageScope } from "../lib/language-scope";
import { byNewest, toStory, type FeedState, type Story } from "../lib/stories";
import { useToday } from "../lib/today";
import { homeHint } from "../i18n";
import { FindSources } from "./find-sources";
import { StoryBlock } from "./stories";

interface Props {
  c: ChromeTokens;
  tokens: ReadingTokens;
  dark: boolean;
  /** The language's feeds (the page fetches them). */
  feeds: Feed[];
  feedState: Record<string, FeedState>;
  onOpenUrl: (url: string) => void;
  onSourcesChanged: () => void | Promise<void>;
}

/** Home: a front page across the language's sources, with more of its free sources beneath. A language
 * with no sources yet shows where to find some instead. The words around it are English; the stories
 * keep their own language and direction. */
export function HomeView({ c, tokens, dark, feeds, feedState, onOpenUrl, onSourcesChanged }: Props) {
  const { t } = useTranslation();
  const scope = useLanguageScope();
  const { lang } = scope;

  const stories = useMemo(() => {
    const seen = new Set<string>();
    const out: Story[] = [];
    const now = Date.now();
    for (const f of feeds) {
      for (const it of feedState[f.id]?.items ?? []) {
        if (seen.has(it.link)) continue;
        seen.add(it.link);
        out.push(toStory(it, f, now));
      }
    }
    return out.sort(byNewest);
  }, [feeds, feedState]);

  const loading = feeds.some((f) => feedState[f.id]?.loading);
  const [hero, ...rest] = stories;
  const ticker = stories.filter((s) => s.time).slice(0, 14);
  const hasSources = scope.sourceNames.length > 0;
  const today = useToday();

  return (
    <div data-home style={{ minHeight: "100%", background: tokens.bg, color: tokens.text, fontFamily: UI_FONT }}>
      {/* Newsbar: the latest headlines from every source. */}
      {hasSources && (
        <div style={{ borderBottom: `1px solid ${tokens.border}`, background: dark ? "#25231F" : "#F5F3EE" }}>
          <div className="readr-newsbar" style={{ display: "flex", gap: 28, overflowX: "auto", padding: "10px 32px", scrollbarWidth: "none" }}>
            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: c.accent, alignSelf: "center" }}>
              {t("home.latest")}
            </span>
            {ticker.length === 0 && <span style={{ fontSize: 12, color: tokens.secondary }}>{t(loading ? "home.loadingHeadlines" : "home.noHeadlines")}</span>}
            {ticker.map((s) => {
              const story = languageScope(s.lang);
              return (
                <button
                  key={s.link}
                  onClick={() => onOpenUrl(s.link)}
                  style={{ flexShrink: 0, maxWidth: 360, display: "flex", gap: 8, alignItems: "baseline", background: "none", border: "none", padding: 0, cursor: "pointer", color: tokens.text, textAlign: "start" }}
                >
                  <span dir={story.dir} lang={s.lang} style={{ fontSize: 10, color: tokens.secondary, whiteSpace: "nowrap" }}>{s.source} · {story.formatRelative(s.time)}</span>
                  <span data-story-title dir={story.dir} lang={s.lang} style={{ fontSize: 13 * story.contentScale, fontFamily: story.contentFont, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 48px 80px" }}>
        <h1 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, letterSpacing: "-0.6px", margin: "0 0 4px" }}>{t("home.title")}</h1>
        <div style={{ fontSize: 12, color: tokens.secondary, marginBottom: hasSources ? 6 : 32 }}>{t("home.date", { date: today })}</div>
        {hasSources && (
          <div data-home-hint style={{ fontSize: 13, color: tokens.secondary, marginBottom: 32, lineHeight: 1.5 }}>
            {homeHint(scope.sourceNames)}
          </div>
        )}

        {hasSources ? (
          <>
            <section data-home-lang={lang} dir={scope.dir} lang={lang} style={{ marginBottom: 48 }}>
              {hero && <StoryBlock lead={hero} rest={rest} tokens={tokens} onOpen={onOpenUrl} />}
              {!hero && !loading && <div dir="ltr" style={{ fontSize: 13, color: tokens.secondary }}>{t("home.nothingToRead")}</div>}
            </section>
            <FindSources lang={lang} tokens={tokens} dark={dark} variant="more" onChanged={onSourcesChanged} />
          </>
        ) : (
          <div data-home-lang={lang}>
            <FindSources lang={lang} tokens={tokens} dark={dark} onChanged={onSourcesChanged} />
          </div>
        )}
      </div>
    </div>
  );
}
