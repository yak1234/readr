import React from "react";
import { PictureInPicture2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReadingStyle } from "../lib/theme";

const bar: Record<ReadingStyle, { bar: string; border: string; text: string; secondary: string; highlight: string }> = {
  light: { bar: "#FAFAF7", border: "#E8E6E0", text: "#1C1B18", secondary: "#9E9C97", highlight: "#C9A060" },
  sepia: { bar: "#F0E8D2", border: "#DED3BE", text: "#3A2F1E", secondary: "#8A7B5E", highlight: "#B8813A" },
  dark: { bar: "#1E1D1A", border: "#3E3C38", text: "#E8E6E0", secondary: "#6B6963", highlight: "#D4A853" },
  paper: { bar: "#F3EFE6", border: "#E2DDD4", text: "#2E2C28", secondary: "#8A8680", highlight: "#B89860" },
};

const SPEEDS = [0.6, 0.75, 0.9, 1.0, 1.25, 1.5];

interface Props {
  style: ReadingStyle;
  source: string;
  title: string;
  playing: boolean;
  index: number;
  total: number;
  remainingSeconds: number;
  rate: number;
  onRate: (r: number) => void;
  voices: string[];
  voicesReady: boolean;
  /** Shown instead of the title while waiting for audio or after an error. */
  status: string | null;
  voice: string;
  onVoice: (voice: string) => void;
  onPlay: () => void;
  onPause: () => void;
  /** Space kept below, e.g. for the radio bar. */
  bottom?: number;
  onPrev: () => void;
  onNext: () => void;
  left: number;
  right: number;
  /** Back to the article being read, at the sentence being spoken. */
  onOpenArticle: () => void;
  /** Open the small always-on-top window. */
  onPopOut: () => void;
}

export function AudioPlayer(p: Props) {
  const { t } = useTranslation();
  const ui = bar[p.style];
  const progress = p.total ? ((p.index + (p.playing ? 0.5 : 0)) / p.total) * 100 : 0;
  const nextRate = () => p.onRate(SPEEDS[(SPEEDS.indexOf(p.rate) + 1) % SPEEDS.length] ?? 1);
  const m = Math.floor(p.remainingSeconds / 60);
  const s = Math.round(p.remainingSeconds % 60);

  const btn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: ui.text, padding: 6, borderRadius: 6, display: "flex" };

  return (
    <div
      data-reader-bar
      style={{
        position: "fixed",
        bottom: p.bottom ?? 0,
        left: p.left,
        right: p.right,
        background: ui.bar,
        borderTop: `1px solid ${ui.border}`,
        padding: "10px 24px 12px",
        zIndex: 50,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: ui.border }}>
        <div style={{ height: "100%", width: `${progress}%`, background: ui.highlight, transition: "width 0.3s linear" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button
          data-reader-goto
          title={t("player.backToArticle")}
          onClick={p.onOpenArticle}
          style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "start", font: "inherit", color: "inherit" }}
        >
          <div data-reader-source dir="ltr" style={{ textAlign: "left", fontSize: 11, color: ui.secondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
            {t("player.nowReading", { source: p.source, index: p.index + 1, total: p.total })}
          </div>
          <div data-reader-title style={{ unicodeBidi: "plaintext", fontSize: 13, fontWeight: 500, color: p.status ? ui.secondary : ui.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.status ?? p.title}</div>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button data-reader-prev title={t("player.previous")} onClick={p.onPrev} style={btn}>
            <SkipBack size={16} strokeWidth={1.8} />
          </button>
          <button
            data-reader-toggle
            title={t(p.playing ? "player.pause" : "player.play")}
            onClick={p.playing ? p.onPause : p.onPlay}
            style={{ width: 36, height: 36, borderRadius: "50%", background: ui.text, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: ui.bar }}
          >
            {p.playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
          </button>
          <button data-reader-next title={t("player.next")} onClick={p.onNext} style={btn}>
            <SkipForward size={16} strokeWidth={1.8} />
          </button>
        </div>

        <button
          onClick={nextRate}
          title={t("player.speed")}
          style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${ui.border}`, background: "transparent", fontSize: 12, fontWeight: 500, color: ui.text, cursor: "pointer", minWidth: 44, fontFamily: "inherit" }}
        >
          {p.rate}×
        </button>

        <select
          value={p.voice}
          title={t("player.voice")}
          onChange={(e) => p.onVoice(e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${ui.border}`, background: ui.bar, fontSize: 11, color: ui.text, cursor: "pointer", outline: "none", fontFamily: "inherit", maxWidth: 180 }}
        >
          <option value="">{t(p.voicesReady ? "player.defaultVoice" : "player.voiceLoading")}</option>
          {p.voices.filter((v) => v !== "Sofia").map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <div style={{ fontSize: 11, color: ui.secondary, minWidth: 48, textAlign: "right" }}>
          -{m}:{s.toString().padStart(2, "0")}
        </div>

        <button data-reader-popout title={t("player.popOut")} onClick={p.onPopOut} style={btn}>
          <PictureInPicture2 size={15} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
