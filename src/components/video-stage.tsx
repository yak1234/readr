import React, { useEffect, useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Repeat, Repeat1, Captions } from "lucide-react";
import type { Article, VideoState } from "../../shared/types";
import { api } from "../lib/api";
import { ReadingTokens, UI_FONT } from "../lib/theme";

interface Props {
  article: Article;
  tokens: ReadingTokens;
  dark: boolean;
  wide: boolean;
  state: VideoState | null;
  index: number; // current sentence, -1 before the first
  total: number;
  looping: boolean;
  overlay: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRepeat: () => void;
  onToggleLoop: () => void;
  onToggleOverlay: () => void;
}

const RATES = [0.5, 0.75, 1, 1.25];

/** The YouTube player sits in a native view that Electron lays over this frame;
 * the frame only reserves the space and reports where it is. */
export function VideoStage(props: Props) {
  const { article, tokens, dark, wide, state } = props;
  const frame = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el || !article.videoId) return;
    const bounds = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    api.videoShow(article.videoId, bounds());
    const report = () => api.videoBounds(bounds());
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      api.videoHide();
    };
  }, [article.videoId]);

  const rate = state?.rate ?? 1;
  const muted = tokens.secondary;
  const border = tokens.border;
  const iconButton = (title: string, onClick: () => void, child: React.ReactNode, on = false) => (
    <button
      title={title}
      onClick={onClick}
      className="readr-video-btn"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 28,
        borderRadius: 6,
        border: `1px solid ${on ? tokens.text : border}`,
        background: on ? tokens.text : "transparent",
        color: on ? tokens.bg : muted,
        cursor: "pointer",
      }}
    >
      {child}
    </button>
  );

  return (
    <div style={{ background: tokens.bg, borderBottom: `1px solid ${border}`, flexShrink: 0, transition: "background 0.3s ease" }}>
      <div style={{ maxWidth: wide ? 1120 : 860, margin: "0 auto", padding: "20px 48px 14px" }}>
        <div
          ref={frame}
          style={{
            // 16:9 at most 46% of the window tall, so the video always fills it.
            width: "min(100%, calc(46vh * 16 / 9))",
            aspectRatio: "16 / 9",
            margin: "0 auto",
            borderRadius: 8,
            background: dark ? "#151412" : "#1C1B18",
            boxShadow: dark ? "0 1px 2px rgba(0,0,0,0.4)" : "0 1px 3px rgba(28,27,24,0.12), 0 8px 24px rgba(28,27,24,0.06)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "12px auto 0", width: "min(100%, calc(46vh * 16 / 9))", fontFamily: UI_FONT }}>
          {iconButton("Previous sentence (A)", props.onPrev, <ChevronLeft size={15} strokeWidth={1.8} />)}
          {iconButton("Replay this sentence (S)", props.onRepeat, <Repeat1 size={14} strokeWidth={1.8} />)}
          {iconButton("Next sentence (D)", props.onNext, <ChevronRight size={15} strokeWidth={1.8} />)}
          <div style={{ width: 1, height: 18, background: border, margin: "0 6px" }} />
          {iconButton("Loop this sentence", props.onToggleLoop, <Repeat size={13} strokeWidth={1.8} />, props.looping)}
          {iconButton("Subtitles on the video", props.onToggleOverlay, <Captions size={14} strokeWidth={1.8} />, props.overlay)}
          <div style={{ display: "flex", gap: 2, marginLeft: 6, padding: 2, borderRadius: 6, background: dark ? "#33312D" : "#ECEAE4" }}>
            {RATES.map((r) => {
              const on = Math.abs(rate - r) < 0.01;
              return (
                <button
                  key={r}
                  title={`Speed ${r}× ([ and ])`}
                  onClick={() => api.videoRate(r - rate)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: "none",
                    fontSize: 11,
                    fontFamily: UI_FONT,
                    cursor: "pointer",
                    background: on ? (dark ? "#4A4844" : "#FAFAF7") : "transparent",
                    color: on ? tokens.text : muted,
                    fontWeight: on ? 500 : 400,
                    boxShadow: on ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {r}×
                </button>
              );
            })}
          </div>
          <div style={{ flex: 1 }} />
          <div data-video-counter style={{ fontSize: 11, color: muted, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>
            {state?.ad ? "Publicité…" : `${Math.max(1, props.index + 1)} / ${props.total} · ${clock(state?.time ?? 0)}`}
          </div>
        </div>
      </div>
    </div>
  );
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Subscribe to player updates for the open video. */
export function useVideoState(active: boolean, onState: (s: VideoState) => void) {
  const cb = useRef(onState);
  cb.current = onState;
  useEffect(() => {
    if (!active) return;
    return api.onVideoState((s) => cb.current(s));
  }, [active]);
}
