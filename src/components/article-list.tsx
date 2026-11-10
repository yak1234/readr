// Article rows: a saved article, its title in its own language and direction, the line under it in the
// chrome's; and the group labels between them.

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ArticleSummary } from "../../shared/types";
import { languageScope } from "../lib/language-scope";
import type { ChromeTokens } from "../lib/theme";

export function GroupLabel({ children, c }: { children: React.ReactNode; c: ChromeTokens }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px 4px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: c.muted,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

/** An article row: its title in its own language and direction, the meta line in the chrome's. */
export function ArticleCard({
  c,
  title,
  lang,
  meta,
  imageUrl,
  progress,
  onClick,
}: {
  c: ChromeTokens;
  title: string;
  lang: string;
  /** The row's second line, chrome: "Le Monde · 4 min", English, left to right, names isolated. */
  meta: string;
  imageUrl: string;
  progress: number;
  onClick: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const content = languageScope(lang);
  return (
    <button
      onClick={onClick}
      className="readr-hover"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "8px 16px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "start",
        ["--hover" as string]: c.hover,
      }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: c.border }}>
        {imageUrl && imgOk && (
          <img src={imageUrl} alt="" onError={() => setImgOk(false)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          data-article-title
          dir="auto"
          lang={lang}
          style={{
            textAlign: "left",
            fontFamily: content.fontOver("inherit"),
            fontSize: 11 * content.contentScale,
            fontWeight: 500,
            color: c.text,
            lineHeight: 1.35,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {title}
        </div>
        <div data-article-meta dir="ltr" style={{ fontSize: 10, color: c.muted, marginTop: 3, textAlign: "left" }}>{meta}</div>
        {progress > 0 && (
          <div style={{ marginTop: 4, height: 2, background: c.border, borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: c.accent }} />
          </div>
        )}
      </div>
    </button>
  );
}

/** The saved articles of a list (reading list, favorites, archive): today's first, then the rest. */
export function LibraryRows({ c, library, list, onOpen }: { c: ChromeTokens; library: ArticleSummary[]; list: "reading-list" | "favorites" | "archive"; onOpen: (url: string) => void }) {
  const { t } = useTranslation();
  const filtered = library.filter((a) => a.kind !== "radio" && a.kind !== "tv" && (list === "favorites" ? a.favorite : list === "archive" ? a.archived : !a.archived));
  const today = new Date().toDateString();
  const todays = filtered.filter((a) => new Date(a.savedAt).toDateString() === today);
  const earlier = filtered.filter((a) => new Date(a.savedAt).toDateString() !== today);
  const card = (a: ArticleSummary) => (
    <ArticleCard key={a.id} c={c} title={a.title} lang={a.language} meta={t("sidebar.readingTime", { source: a.source, minutes: a.readingTime })} imageUrl={a.imageUrl} progress={a.progress} onClick={() => onOpen(a.url)} />
  );
  return (
    <>
      {filtered.length === 0 && <div style={{ padding: "10px 16px", fontSize: 11, color: c.muted, lineHeight: 1.5 }}>{t(list === "reading-list" ? "sidebar.nothingSaved" : "sidebar.nothingHere")}</div>}
      {todays.length > 0 && <GroupLabel c={c}>{t("sidebar.today")}</GroupLabel>}
      {todays.map(card)}
      {earlier.length > 0 && <GroupLabel c={c}>{t("sidebar.recently")}</GroupLabel>}
      {earlier.map(card)}
    </>
  );
}
