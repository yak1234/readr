// The title bar: the panel icon and Back and Forward beside the window controls, the view modes and Listen while something is
// being read, the language menu, dark mode and the reading settings.

import { useTranslation } from "react-i18next";
import { Moon, PanelRight, Sun } from "lucide-react";
import type { ChromeKey } from "../i18n";
import { languageScope, useLanguageScope } from "../lib/language-scope";
import { UI_FONT, type ViewMode } from "../lib/theme";
import { LanguageMenu } from "./language-menu";
import { NavButtons } from "./nav-buttons";
import { SidebarToggle } from "./sidebar-toggle";
import { useReader } from "./reader-provider";
import { useReading } from "./reading-provider";
import { useReadrSettings } from "./settings-provider";

export const VIEW_MODES: { id: ViewMode; label: ChromeKey }[] = [
  { id: "original", label: "viewModes.original" },
  { id: "interlinear", label: "viewModes.interlinear" },
  { id: "bilingual", label: "viewModes.bilingual" },
  { id: "translation", label: "viewModes.translation" },
];

/** Room kept on the left for the window's own buttons (macOS). */
const WINDOW_CONTROLS = 78;

export function TitleBar({ leftWidth }: { leftWidth: number }) {
  const { t } = useTranslation();
  const { settings, update, dark, c } = useReadrSettings();
  const reader = useReader();
  const { article } = useReading();
  const showing = useLanguageScope().lang;
  const bg = dark ? "#1E1D1A" : "#F2F0EB";
  const border = dark ? "#3E3C38" : "#E5E2D9";
  const text = dark ? "#E8E6E0" : "#1C1B18";
  const muted = dark ? "#6B6963" : "#9E9C97";
  const distractionFree = settings.focusMode === "article";
  const listening = reader.listening && reader.article?.id === article?.id;

  return (
    <div className="readr-drag" style={{ height: 44, display: "flex", alignItems: "center", background: bg, borderBottom: `1px solid ${border}`, flexShrink: 0, zIndex: 40 }}>
      <div style={{ width: leftWidth, minWidth: leftWidth, display: "flex", alignItems: "center", gap: 4, paddingLeft: WINDOW_CONTROLS, boxSizing: "border-box" }}>
        <SidebarToggle color={muted} dot={c.accent} />
        <NavButtons color={muted} disabledColor={border} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", overflow: "hidden" }}>
        {article && (
          <div data-view-tabs className="readr-no-drag" style={{ display: "flex", gap: 2, background: dark ? "#2A2825" : "#ECEAE4", borderRadius: 6, padding: 3, minWidth: 0, overflow: "hidden" }}>
            {VIEW_MODES.map((m, i) => {
              const on = settings.viewMode === m.id;
              return (
                <button
                  key={m.id}
                  title={t("viewModes.shortcut", { label: t(m.label), key: i + 1 })}
                  onClick={() => update("viewMode", m.id)}
                  style={{ padding: "3px 12px", borderRadius: 4, border: "none", background: on ? (dark ? "#3E3C38" : "#FAFAF7") : "transparent", fontSize: 11, fontWeight: on ? 500 : 400, color: on ? text : muted, cursor: "pointer", fontFamily: UI_FONT, boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}
                >
                  {t(m.label)}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="readr-no-drag" data-title-right style={{ flexShrink: 0, width: "max-content", display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, gap: 4 }}>
        <LanguageMenu />
        {article && !article.live && languageScope(article.language).speak && (
          <button
            onClick={() => reader.toggle(article)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 5, border: `1px solid ${border}`, background: listening ? text : "transparent", color: listening ? bg : muted, fontSize: 11, cursor: "pointer", fontFamily: UI_FONT }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            {t(listening ? "app.stop" : "app.listen")}
          </button>
        )}
        {/* Only when the text isn't in the language showing: plain words, never a code. */}
        {article && showing && article.language !== showing && (
          <span data-article-lang style={{ padding: "0 6px", fontSize: 11, color: muted, whiteSpace: "nowrap" }}>
            {t("app.readingLanguage", { language: languageScope(article.language).name })}
          </span>
        )}
        <button title={t("app.darkMode")} onClick={() => update("readingStyle", dark ? "light" : "dark")} style={{ background: "none", border: "none", cursor: "pointer", color: muted, padding: 6, display: "flex" }}>
          {dark ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
        </button>
        <button
          title={t(distractionFree ? "app.exitFocus" : "app.readingSettings")}
          onClick={() => (distractionFree ? update("focusMode", "off") : update("showRightPanel", !settings.showRightPanel))}
          style={{ background: "none", border: "none", cursor: "pointer", color: muted, padding: "4px 6px", fontFamily: "Georgia, serif", fontSize: 13, display: "flex", alignItems: "center" }}
        >
          {distractionFree ? <PanelRight size={15} strokeWidth={1.8} /> : "Aa"}
        </button>
      </div>
    </div>
  );
}
