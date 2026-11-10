// A source's newspaper page, laid out from its model (lib/source-page): the masthead (the source's name in its
// own language and face, the date, an index of its sections and the Sections control), then one block per
// followed section: its lead beside a column of headlines, then the rest. The page is English chrome, left to
// right, whatever the source; only the content in it (the source's name, section names, the stories) takes its
// own language and direction.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { NoticeButton } from "../components/notice";
import { StoryBlock, StoryBlockSkeleton } from "../components/stories";
import { languageScope } from "../lib/language-scope";
import type { PageSection, SourcePageModel } from "../lib/source-page";
import { SERIF, UI_FONT, type ChromeTokens, type ReadingTokens } from "../lib/theme";
import { useToday } from "../lib/today";

interface Props {
  c: ChromeTokens;
  tokens: ReadingTokens;
  name: string;
  lang: string;
  model: SourcePageModel;
  /** The section the page was opened at (a feed id), marked in the index. */
  current: string | undefined;
  onOpenStory: (url: string) => void;
  onOpenSection: (feedId: string) => void;
  onRetry: (feedId: string) => void;
  onChooseSections: () => void;
  /** Fetch every section again; `refreshing` while any is being fetched. */
  onRefresh: () => void;
  refreshing: boolean;
}

/** Headlines beside a section's lead, and cards under it before "More stories". */
const LINES = 4;
const CARDS = 6;

export function SourceView({ c, tokens, name, lang, model, current, onOpenStory, onOpenSection, onRetry, onChooseSections, onRefresh, refreshing }: Props) {
  const { t } = useTranslation();
  const today = useToday();
  const own = languageScope(lang);
  const named = model.sections.flatMap((s) => (s.heading.kind === "named" ? [{ feedId: s.feedId, name: s.heading.name }] : []));
  const ruleColor = tokens.text;
  const quiet = { padding: "5px 12px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.body, cursor: "pointer", fontFamily: UI_FONT } as const;

  return (
    <div data-page="source" dir="ltr" style={{ minHeight: "100%", background: tokens.bg, color: tokens.text, fontFamily: UI_FONT }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 48px 80px" }}>
        <header data-source-masthead style={{ position: "relative", textAlign: "center", marginBottom: 32 }}>
          <div style={{ position: "absolute", right: 0, top: 4, display: "flex", gap: 8 }}>
            <button data-source-refresh title={t("sourcePage.refreshAll", { source: name })} onClick={onRefresh} disabled={refreshing} style={{ ...quiet, display: "flex", alignItems: "center", gap: 6, cursor: refreshing ? "default" : "pointer" }}>
              <RefreshCw size={12} className={refreshing ? "readr-spin" : undefined} />
              {t("sourcePage.refresh")}
            </button>
            <button data-source-sections title={t("sourcePage.chooseSections", { source: name })} onClick={onChooseSections} style={quiet}>
              {t("sourcePage.sections")}
            </button>
          </div>
          <div style={{ fontSize: 11, color: tokens.secondary, letterSpacing: "0.02em", marginBottom: 10 }}>{t("home.date", { date: today })}</div>
          <h1 data-source-title dir={own.dir} lang={lang} style={{ fontFamily: own.contentFont, fontSize: 44 * own.contentScale, fontWeight: 600, letterSpacing: "-0.8px", lineHeight: 1.1, margin: "0 0 14px" }}>
            {name}
          </h1>
          {named.length > 1 && (
            <nav data-section-index dir={own.dir} lang={lang} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 22px", padding: "10px 0", borderTop: `1px solid ${tokens.border}` }}>
              {named.map((s) => (
                <button
                  key={s.feedId}
                  onClick={() => onOpenSection(s.feedId)}
                  aria-current={s.feedId === current ? "true" : undefined}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: own.contentFont, fontSize: 14 * own.contentScale, color: s.feedId === current ? tokens.text : tokens.secondary, textDecoration: s.feedId === current ? "underline" : "none", textUnderlineOffset: 4 }}
                >
                  {s.name}
                </button>
              ))}
            </nav>
          )}
          <div style={{ borderTop: `3px double ${ruleColor}`, opacity: 0.85 }} />
        </header>

        {model.sections.length === 0 ? (
          <div data-source-empty style={{ textAlign: "center", fontSize: 14, color: tokens.secondary, lineHeight: 1.6 }}>
            <p style={{ margin: "0 0 12px" }}>{t("sourcePage.noSections", { source: name })}</p>
            <NoticeButton tokens={tokens} onClick={onChooseSections}>{t("sourcePage.sections")}</NoticeButton>
          </div>
        ) : (
          model.sections.map((s, i) => <SectionBlock key={s.feedId} tokens={tokens} section={s} first={i === 0} onOpenStory={onOpenStory} onRetry={onRetry} />)
        )}
      </div>
    </div>
  );
}

/** One section: its heading over a rule, then its stories, or a calm word on why there are none. */
function SectionBlock({ tokens, section, first, onOpenStory, onRetry }: { tokens: ReadingTokens; section: PageSection; first: boolean; onOpenStory: (url: string) => void; onRetry: (feedId: string) => void }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const content = languageScope(section.lang);
  const hidden = Math.max(0, section.items.length - LINES - CARDS);
  const heading = { margin: "0 0 18px", paddingTop: first ? 0 : 10, borderTop: first ? "none" : `2px solid ${tokens.text}`, fontWeight: 600, letterSpacing: "-0.2px" } as const;
  return (
    <section data-source-section={section.feedId} data-status={section.status} style={{ marginBottom: 48, scrollMarginTop: 16 }}>
      {/* A section's own name is content, in its language and direction; "Latest" is chrome. */}
      {section.heading.kind === "named" ? (
        <h2 data-section-heading dir={content.dir} lang={section.lang} style={{ ...heading, fontFamily: content.contentFont, fontSize: 21 * content.contentScale }}>{section.heading.name}</h2>
      ) : (
        <h2 data-section-heading style={{ ...heading, fontFamily: SERIF, fontSize: 21 }}>{t("sourcePage.latest")}</h2>
      )}
      {section.status === "loading" && <StoryBlockSkeleton tokens={tokens} />}
      {section.status === "failed" && (
        <div data-section-failed title={section.error} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: tokens.secondary }}>
          {t("sourcePage.failed")}
          <NoticeButton tokens={tokens} onClick={() => onRetry(section.feedId)}>{t("sourcePage.retry")}</NoticeButton>
        </div>
      )}
      {section.status === "ready" && !section.lead && (
        <div style={{ fontSize: 13, color: tokens.secondary }}>{t("sourcePage.empty")}</div>
      )}
      {section.lead && (
        <>
          <div dir={content.dir} lang={section.lang}>
            <StoryBlock lead={section.lead} rest={section.items} tokens={tokens} onOpen={onOpenStory} withSource={false} bigLead={first} lines={LINES} cards={all ? Infinity : CARDS} />
          </div>
          {hidden > 0 && (
            <div style={{ marginTop: 20 }}>
              <NoticeButton tokens={tokens} onClick={() => setAll((x) => !x)}>{t(all ? "sourcePage.fewer" : "sourcePage.more")}</NoticeButton>
            </div>
          )}
        </>
      )}
    </section>
  );
}
