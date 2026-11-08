import React from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
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
  voices: SpeechSynthesisVoice[];
  voiceURI: string;
  onVoice: (uri: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  left: number;
  right: number;
}

export function AudioPlayer(p: Props) {
  const t = bar[p.style];
  const progress = p.total ? ((p.index + (p.playing ? 0.5 : 0)) / p.total) * 100 : 0;
  const nextRate = () => p.onRate(SPEEDS[(SPEEDS.indexOf(p.rate) + 1) % SPEEDS.length] ?? 1);
  const m = Math.floor(p.remainingSeconds / 60);
  const s = Math.round(p.remainingSeconds % 60);

  const btn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", color: t.text, padding: 6, borderRadius: 6, display: "flex" };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: p.left,
        right: p.right,
        background: t.bar,
        borderTop: `1px solid ${t.border}`,
        padding: "10px 24px 12px",
        zIndex: 50,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: t.border }}>
        <div style={{ height: "100%", width: `${progress}%`, background: t.highlight, transition: "width 0.3s linear" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: t.secondary, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
            Now reading · {p.source} · {p.index + 1}/{p.total}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button title="Previous sentence" onClick={p.onPrev} style={btn}>
            <SkipBack size={16} strokeWidth={1.8} />
          </button>
          <button
            title={p.playing ? "Pause" : "Play"}
            onClick={p.playing ? p.onPause : p.onPlay}
            style={{ width: 36, height: 36, borderRadius: "50%", background: t.text, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.bar }}
          >
            {p.playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
          </button>
          <button title="Next sentence" onClick={p.onNext} style={btn}>
            <SkipForward size={16} strokeWidth={1.8} />
          </button>
        </div>

        <button
          onClick={nextRate}
          title="Speed"
          style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${t.border}`, background: "transparent", fontSize: 12, fontWeight: 500, color: t.text, cursor: "pointer", minWidth: 44, fontFamily: "inherit" }}
        >
          {p.rate}×
        </button>

        <select
          value={p.voiceURI}
          onChange={(e) => p.onVoice(e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${t.border}`, background: t.bar, fontSize: 11, color: t.text, cursor: "pointer", outline: "none", fontFamily: "inherit", maxWidth: 180 }}
        >
          <option value="">{p.voices.length ? "Default French voice" : "No French voice installed"}</option>
          {p.voices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>

        <div style={{ fontSize: 11, color: t.secondary, minWidth: 48, textAlign: "right" }}>
          -{m}:{s.toString().padStart(2, "0")}
        </div>
      </div>
    </div>
  );
}
