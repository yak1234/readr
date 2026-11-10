import React, { useState } from "react";
import { Download, ExternalLink, LogIn, Star, Archive, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TRANSLATABLE, languageInfo } from "../../shared/languages";
import type { Article, SidecarStatus, Site } from "../../shared/types";
import type { ChromeTokens, FocusMode, ReadingFont, ReadingStyle } from "../lib/theme";
import { clampNewCardsPerDay, MAX_NEW_CARDS_PER_DAY, type Settings } from "../lib/settings";
import { api } from "../lib/api";
import { ImportLogins } from "./import-logins";
import { RadioPanel, type RadioPanelProps } from "./radio-panel";
import { EarlierList } from "./earlier-list";
import type { LiveSession } from "../../shared/live-history";
import { ChipButton, Divider, SectionLabel, Slider, ToggleRow } from "./ui";

interface Props {
  c: ChromeTokens;
  article: Article | null;
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  readingProgress: number;
  sites: Site[];
  onLogin: (siteId: string) => void;
  onViewOriginal: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  status: SidecarStatus | null;
  translatedCount: number;
  /** Set while a radio transcript is open: its settings replace the article ones. */
  radio?: RadioPanelProps;
  /** Opens another of the station's past sessions, while one is being read. */
  onOpenSession: (session: LiveSession) => void;
}

// Labels are en.json keys: panel.styles.<id>, panel.fonts.<id>, panel.focusModes.<id> (and <id>Hint).
const styles: { id: ReadingStyle; bg: string; fg: string }[] = [
  { id: "light", bg: "#FFFFFF", fg: "#1C1B18" },
  { id: "sepia", bg: "#F5EFE0", fg: "#4A3F2F" },
  { id: "dark", bg: "#2A2825", fg: "#E8E6E0" },
  { id: "paper", bg: "#F9F6EF", fg: "#3A3730" },
];

const fonts: { id: ReadingFont; family: string }[] = [
  { id: "georgia", family: "Georgia, serif" },
  { id: "literata", family: "'Literata', Georgia, serif" },
  { id: "source", family: "'Source Serif 4', 'Source Serif Pro', Georgia, serif" },
];

const focusModes: FocusMode[] = ["off", "article", "sentence", "line"];

export function RightPanel(props: Props) {
  const { c, article, settings, update, readingProgress, sites, onLogin, onViewOriginal, status } = props;
  const { t } = useTranslation();

  return (
    <aside
      style={{
        width: 210,
        minWidth: 210,
        background: c.panel,
        borderLeft: `1px solid ${c.border}`,
        overflowY: "auto",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ padding: "20px 16px" }}>
        {props.radio && (
          <>
            <RadioPanel {...props.radio} />
            <Divider c={c} />
          </>
        )}
        {article?.past && (
          <>
            <SectionLabel c={c}>{t("panel.earlierTranscript")}</SectionLabel>
            <div data-past-panel style={{ fontSize: 13, fontWeight: 600, color: c.text, unicodeBidi: "plaintext", textAlign: "left" }}>{article.title}</div>
            <div style={{ fontSize: 11, color: c.muted, margin: "3px 0 12px", lineHeight: 1.4 }}>{article.date}</div>
            <EarlierList c={c} stationIds={[article.past.stationId ?? "", article.url].filter(Boolean)} currentSessionId={article.past.sessionId} onOpen={props.onOpenSession} />
            <Divider c={c} />
          </>
        )}
        <SectionLabel c={c}>{t("panel.style")}</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {styles.map((s) => {
            const active = settings.readingStyle === s.id;
            return (
              <button
                key={s.id}
                onClick={() => update("readingStyle", s.id)}
                style={{
                  padding: "6px 4px",
                  borderRadius: 5,
                  border: active ? `1.5px solid ${c.accent}` : `1.5px solid ${c.border}`,
                  background: s.bg,
                  fontSize: 11,
                  color: active ? s.fg : "#6B6963",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: active ? "0 0 0 2px rgba(184,169,138,0.2)" : "none",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {t(`panel.styles.${s.id}`)}
              </button>
            );
          })}
        </div>

        <Divider c={c} />

        <SectionLabel c={c}>{t("panel.textSize")}</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: c.muted }}>A</span>
          <Slider c={c} value={settings.fontSize} onChange={(v) => update("fontSize", v)} min={80} max={160} step={10} />
          <span style={{ fontSize: 14, color: c.muted, fontWeight: 500 }}>A</span>
        </div>
        <div style={{ fontSize: 11, color: c.faint, marginTop: 4, textAlign: "center" }}>{settings.fontSize}%</div>

        <Divider c={c} />

        <SectionLabel c={c}>{t("panel.font")}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {fonts.map((f) => (
            <ChipButton key={f.id} c={c} active={settings.font === f.id} onClick={() => update("font", f.id)} style={{ fontFamily: f.family, fontSize: 13, textAlign: "left", padding: "6px 10px" }}>
              {t(`panel.fonts.${f.id}`)}
            </ChipButton>
          ))}
        </div>

        <Divider c={c} />

        <SectionLabel c={c}>{t("panel.focus")}</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {focusModes.map((id) => (
            <ChipButton key={id} c={c} title={t(`panel.focusModes.${id}Hint`)} active={settings.focusMode === id} onClick={() => update("focusMode", id)}>
              {t(`panel.focusModes.${id}`)}
            </ChipButton>
          ))}
        </div>

        {!props.radio && (
          <>
            <Divider c={c} />

            <SectionLabel c={c}>{t("panel.translation")}</SectionLabel>
            <ToggleRow c={c} label={t("panel.showTranslation")} checked={settings.viewMode !== "original"} onChange={(v) => update("viewMode", v ? "interlinear" : "original")} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
              <span style={{ fontSize: 13, color: c.text }}>{t("panel.translateInto")}</span>
              <select
                value={settings.targetLang}
                onChange={(e) => update("targetLang", e.target.value)}
                style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", fontSize: 12, color: c.text, outline: "none", fontFamily: "inherit", maxWidth: 150 }}
              >
                {TRANSLATABLE.map((code) => (
                  <option key={code} value={code}>
                    {languageInfo(code).name}
                  </option>
                ))}
              </select>
            </div>
            <ToggleRow c={c} label={t("panel.hideUntilHover")} checked={settings.blurTranslation} onChange={(v) => update("blurTranslation", v)} />
          </>
        )}

        {article && !props.radio && !article.past && (
          <>
            <Divider c={c} />
            <SectionLabel c={c}>{t("panel.about")}</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <MetaRow c={c} label={t("panel.published")} value={article.date || "—"} />
              <MetaRow c={c} label={t("panel.author")} value={article.author || "—"} />
              <MetaRow c={c} label={t("panel.readTime")} value={t("panel.minutes", { count: article.readingTime })} />
              <MetaRow c={c} label={t("panel.translated")} value={t("panel.sentences", { count: props.translatedCount })} />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("panel.progress")}</span>
                <span style={{ fontSize: 10, color: c.muted }}>{readingProgress}%</span>
              </div>
              <div style={{ height: 3, background: c.border, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${readingProgress}%`, background: c.accent, transition: "width 0.3s ease" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
              <ChipButton c={c} title={t("panel.favorite")} active={!!article.favorite} onClick={props.onToggleFavorite} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <Star size={12} />
              </ChipButton>
              <ChipButton c={c} title={t("panel.archive")} active={!!article.archived} onClick={props.onToggleArchive} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <Archive size={12} />
              </ChipButton>
              <ChipButton c={c} title={t("panel.remove")} active={false} onClick={props.onDelete} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <Trash2 size={12} />
              </ChipButton>
            </div>

            <Divider c={c} />

            <OutlineButton c={c} onClick={onViewOriginal}>
              <ExternalLink size={12} />
              {t("panel.viewOriginal")}
            </OutlineButton>
          </>
        )}

        <Divider c={c} />

        <SectionLabel c={c}>{t("panel.flashcards")}</SectionLabel>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
          <span style={{ fontSize: 13, color: c.text }}>{t("panel.newPerDay")}</span>
          <input
            data-new-cards-per-day
            type="number"
            min={0}
            max={MAX_NEW_CARDS_PER_DAY}
            step={1}
            value={settings.newCardsPerDay}
            onChange={(e) => e.target.value !== "" && update("newCardsPerDay", clampNewCardsPerDay(e.target.valueAsNumber))}
            style={{ width: 56, padding: "4px 6px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", fontSize: 12, color: c.text, outline: "none", fontFamily: "inherit", textAlign: "right" }}
          />
        </label>
        <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, marginTop: 4 }}>{t("panel.newPerDayNote")}</div>

        <Divider c={c} />

        <SectionLabel c={c}>{t("panel.subscriptions")}</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {sites.filter((s) => !s.free).map((s) => (
            <OutlineButton key={s.id} c={c} onClick={() => onLogin(s.id)}>
              <LogIn size={12} />
              {s.name}
            </OutlineButton>
          ))}
        </div>
        <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, marginTop: 6 }}>
          {t("panel.subscriptionsNote")}
        </div>
        <BrowserLogin c={c} />

        <Divider c={c} />

        <SectionLabel c={c}>{t("panel.engine")}</SectionLabel>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: c.body, lineHeight: 1.45 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, marginTop: 4, flexShrink: 0, background: status?.ok ? "#7A9A5E" : "#C2884A" }} />
          <span>
            {status?.ok
              ? `${status.translator || t("panel.translator")}${status.stanza ? " · Stanza" : ""}${status.dictionary ? " · Wiktionary" : ""}`
              : status?.message ?? t("panel.checking")}
          </span>
        </div>
      </div>
    </aside>
  );
}

function MetaRow({ c, label, value }: { c: ChromeTokens; label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
      <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: c.text, textAlign: "right", lineHeight: 1.3 }}>{value}</span>
    </div>
  );
}

/** A button with the panel's outline; other props pass through (a dialog's trigger needs them). */
function OutlineButton({ c, children, ...rest }: { c: ChromeTokens } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="readr-outline"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        padding: 8,
        borderRadius: 6,
        border: `1.5px solid ${c.border}`,
        background: "transparent",
        fontSize: 12,
        color: c.body,
        cursor: "pointer",
        fontFamily: "inherit",
        ["--accent" as string]: c.accent,
        ["--text" as string]: c.text,
      }}
    >
      {children}
    </button>
  );
}

/** Open the import dialog: copy chosen sites' logins from the user's everyday browser
 * (for sites signed in with Google, which won't sign in inside an app). */
function BrowserLogin({ c }: { c: ChromeTokens }) {
  const { t } = useTranslation();
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
      <ImportLogins
        trigger={
          <OutlineButton c={c}>
            <Download size={12} />
            {t("panel.importLogins")}
          </OutlineButton>
        }
      />
      <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, marginTop: 2 }}>
        {t("panel.googleNote")}
      </div>
    </div>
  );
}
