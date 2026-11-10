import { useTranslation } from "react-i18next";
import type { ChromeKey } from "../i18n";
import { LANGUAGES, TRANSLATABLE, languageInfo } from "../../shared/languages";
import type { Article, Station } from "../../shared/types";
import type { ChromeTokens } from "../lib/theme";
import { stationTarget, type Settings } from "../lib/settings";
import { ChipButton, Divider, SectionLabel, ToggleRow } from "./ui";
import { EarlierList } from "./earlier-list";
import type { LiveSession } from "../../shared/live-history";

export interface RadioPanelProps {
  c: ChromeTokens;
  article: Article;
  /** The station behind the stream, when known (saved, or being tried from the finder). */
  station?: Station;
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** Files the station under another language and restarts its captions. */
  onLanguage: (lang: string) => void;
  /** Whether the station is in the user's list (else it is only being tried). */
  saved: boolean;
  onSave: () => void;
  translatedCount: number;
  /** Arabic that isn't news: captions may be unreliable for dialect. */
  captionNote: string | null;
  /** A TV channel rather than a radio station (labels only). */
  tv?: boolean;
  /** Opens one of the station's past sessions (the Earlier list). */
  onOpenSession: (session: LiveSession) => void;
}

const WINDOWS: { minutes: Settings["liveWindowMinutes"]; label: ChromeKey }[] = [
  { minutes: 15, label: "radioPanel.window15" },
  { minutes: 30, label: "radioPanel.window30" },
  { minutes: 60, label: "radioPanel.window60" },
  { minutes: 0, label: "radioPanel.windowAll" },
];

/** The right panel's radio settings, shown instead of an article's details. */
export function RadioPanel({ c, article, station, settings, update, onLanguage, saved, onSave, translatedCount, captionNote, tv, onOpenSession }: RadioPanelProps) {
  const { t } = useTranslation();
  const select: React.CSSProperties = { padding: "4px 8px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", fontSize: 12, color: c.text, outline: "none", fontFamily: "inherit", width: "100%", minWidth: 0 };
  const target = stationTarget(settings, article.url);
  const info = station
    ? [
        [t("radioPanel.country"), station.country],
        [t("radioPanel.format"), [station.codec, station.bitrate ? `${station.bitrate} kbps` : ""].filter(Boolean).join(" ")],
      ].filter(([, v]) => v)
    : [];
  const site = station?.homepage && /^https?:/.test(station.homepage) ? station.homepage : "";

  return (
    <div data-radio-panel>
      <SectionLabel c={c}>{t(tv ? "radioPanel.channel" : "radioPanel.station")}</SectionLabel>
      <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 8, unicodeBidi: "plaintext", textAlign: "left" }}>{article.title}</div>
      <Row c={c} label={t("radioPanel.language")}>
        <select
          data-radio-language
          aria-label={t(tv ? "radioPanel.channelLanguage" : "radioPanel.stationLanguage")}
          title={t(tv ? "radioPanel.languageTitleChannel" : "radioPanel.languageTitleStation")}
          value={article.language}
          onChange={(e) => onLanguage(e.target.value)}
          style={select}
        >
          {[...new Set([article.language, ...Object.keys(LANGUAGES)])].sort((a, b) => languageInfo(a).name.localeCompare(languageInfo(b).name)).map((code) => (
            <option key={code} value={code}>{languageInfo(code).name}</option>
          ))}
        </select>
      </Row>
      {station && !saved && (
        <div data-station-preview style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "2px 0 8px" }}>
          <span style={{ fontSize: 10, color: c.muted, lineHeight: 1.4 }}>{t("radioPanel.notSaved")}</span>
          <button data-station-save onClick={onSave} style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.text, fontSize: 11, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>{t(tv ? "radioPanel.saveChannel" : "radioPanel.saveStation")}</button>
        </div>
      )}
      {captionNote && (
        <div data-dialect-note style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, margin: "2px 0 8px" }}>
          {captionNote}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 6 }}>
        {info.map(([label, value]) => (
          <MetaRow key={label} c={c} label={label} value={value} />
        ))}
        {site && (
          <MetaRow
            c={c}
            label={t("radioPanel.website")}
            value={
              <a href={site} target="_blank" rel="noreferrer" style={{ color: c.text }}>
                {site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            }
          />
        )}
      </div>

      <Divider c={c} />

      <SectionLabel c={c}>{t("panel.translation")}</SectionLabel>
      <ToggleRow c={c} label={t("panel.showTranslation")} checked={settings.viewMode !== "original"} onChange={(v) => update("viewMode", v ? "interlinear" : "original")} />
      <Row c={c} label={t("panel.translateInto")}>
        <select
          data-radio-target
          aria-label={t("panel.translateInto")}
          value={target}
          onChange={(e) => update("stationTargets", { ...settings.stationTargets, [article.url]: e.target.value })}
          style={select}
        >
          {TRANSLATABLE.map((code) => (
            <option key={code} value={code}>{languageInfo(code).name}</option>
          ))}
        </select>
      </Row>
      <ToggleRow c={c} label={t("panel.hideUntilHover")} checked={settings.blurTranslation} onChange={(v) => update("blurTranslation", v)} />

      <Divider c={c} />

      <SectionLabel c={c}>{t("radioPanel.keepLast")}</SectionLabel>
      <div data-radio-window style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {WINDOWS.map((w) => (
          <ChipButton key={w.minutes} c={c} active={settings.liveWindowMinutes === w.minutes} onClick={() => update("liveWindowMinutes", w.minutes)}>
            {t(w.label)}
          </ChipButton>
        ))}
      </div>
      <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, marginTop: 6 }}>
        {t(tv ? "radioPanel.droppedChannel" : "radioPanel.droppedStation")}
      </div>
      <div style={{ marginTop: 8 }}>
        <MetaRow c={c} label={t("panel.translated")} value={t("panel.sentences", { count: translatedCount })} />
      </div>

      <Divider c={c} />

      <EarlierList c={c} stationIds={[article.id, article.url]} onOpen={onOpenSession} />
    </div>
  );
}

function Row({ c, label, children }: { c: ChromeTokens; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0 6px" }}>
      <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      {children}
    </div>
  );
}

function MetaRow({ c, label, value }: { c: ChromeTokens; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
      <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: c.text, textAlign: "right", lineHeight: 1.3, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}
