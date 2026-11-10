import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Captions, CaptionsOff, Maximize, Minimize } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Article } from "../../shared/types";
import { previewParagraph } from "../../shared/live-transcript";
import { SUBTITLE_WAIT_MAX, subtitleHold, subtitleView } from "../../shared/tv";
import { useFullscreenElement } from "../lib/fullscreen";
import { tvHolder, tvVideo } from "../lib/radio-player";
import { useLiveError, useLivePartial } from "../lib/live";
import { countRender } from "../lib/store";
import { UI_FONT, type ReadingTokens } from "../lib/theme";
import { languageScope } from "../lib/language-scope";

interface PictureProps {
  article: Article;
  failed: boolean;
  /** Translations of the transcript's sentences into the channel's target language. */
  translations: Record<string, string>;
  /** The translation line is drawn (translation is on and possible). */
  translationOn: boolean;
  translationExpected: boolean;
  subtitles: boolean;
  onSubtitles: (on: boolean) => void;
}

interface Props extends PictureProps {
  tokens: ReadingTokens;
  /** Under the picture: the channel's Earlier list. */
  earlier?: React.ReactNode;
}

/** The stacked layout (a narrow window): the picture stays in view above the transcript, which scrolls
 * under it, with the lag note and the channel's Earlier list beneath. */
export function TvStage({ tokens, earlier, ...picture }: Props) {
  countRender("TvStage");
  return (
    // Sticky: the picture stays in view while the transcript below scrolls under it.
    <div data-tv-sticky style={{ position: "sticky", top: 0, zIndex: 5, background: tokens.bg, padding: "20px 32px 10px", borderBottom: `1px solid ${tokens.border}` }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <TvPicture {...picture} fit="width" />
        <LagNote tokens={tokens} />
        {earlier && <div data-tv-earlier style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>{earlier}</div>}
      </div>
    </div>
  );
}

/** Live captions may trail the picture: said once, small, under it. */
export function LagNote({ tokens }: { tokens: ReadingTokens }) {
  const { t } = useTranslation();
  return <div data-tv-lag-note style={{ fontSize: 11, color: tokens.secondary, marginTop: 6, textAlign: "center" }}>{t("tv.lagNote")}</div>;
}

/** The TV channel's picture with two lines of live subtitles over it: the words being heard (faded) or
 * the newest finished sentence (solid), then that sentence's translation. The <video> belongs to the
 * player; this view only shows it, and gives it back to the hidden holder when it goes.
 * `fit`: "width" is 16:9 across its column; "contain" is the largest 16:9 box its container holds,
 * centred (the container must be a size query container). */
export function TvPicture({ article, failed, translations, translationOn, translationExpected, subtitles, onSubtitles, fit, subtitlesInFullscreen = false }: PictureProps & {
  fit: "width" | "contain";
  /** Full screen shows the subtitles even while they are off (beside the teleprompter, which full screen hides);
   * the toggle then turns them off for that full screen only, leaving the setting as it was. */
  subtitlesInFullscreen?: boolean;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const video = useSyncExternalStore(tvVideo.subscribe, tvVideo.get);
  const fullscreenElement = useFullscreenElement();
  const full = fullscreenElement !== null && fullscreenElement === box.current;
  // Each full screen starts with its subtitles shown.
  const [hiddenInFull, setHiddenInFull] = useState(false);
  const [wasFull, setWasFull] = useState(full);
  if (wasFull !== full) {
    setWasFull(full);
    setHiddenInFull(false);
  }
  const ownInFull = full && subtitlesInFullscreen;
  const shown = ownInFull ? !hiddenInFull : subtitles;
  const toggleSubtitles = () => (ownInFull ? setHiddenInFull(!hiddenInFull) : onSubtitles(!subtitles));

  // Show the player's <video> here; give it back to the hidden holder when leaving.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !video) return;
    Object.assign(video.style, { width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" });
    el.prepend(video);
    return () => {
      if (video.parentElement === el) tvHolder().appendChild(video);
    };
  }, [video]);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => undefined);
  };

  const size: React.CSSProperties = full
    ? { width: "100%", height: "100%" }
    : fit === "contain"
      ? { width: "min(100cqw, calc(100cqh * 16 / 9))", aspectRatio: "16 / 9" }
      : { width: "100%", aspectRatio: "16 / 9" };
  const btn: React.CSSProperties = { background: "rgba(0,0,0,0.45)", border: "none", borderRadius: 5, color: "#F2F0EB", cursor: "pointer", padding: 6, display: "flex" };
  return (
    <div
      ref={box}
      data-tv-stage
      className="readr-tv-stage"
      style={{ position: "relative", ...size, background: "#000", borderRadius: full ? 0 : 8, overflow: "hidden", fontFamily: UI_FONT }}
    >
      {failed && (
        <div data-tv-failed style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#C5C3BC", fontSize: 13 }}>
          {t("tv.unavailable")}
        </div>
      )}
      {shown && !failed && (
        <Subtitles article={article} translations={translations} translationOn={translationOn} translationExpected={translationExpected} large={full} />
      )}
      <div className="readr-tv-controls" style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
        <button data-tv-subtitles title={t(shown ? "tv.hideSubtitles" : "tv.showSubtitles")} aria-pressed={shown} onClick={toggleSubtitles} style={btn}>
          {shown ? <Captions size={15} /> : <CaptionsOff size={15} />}
        </button>
        <button data-tv-fullscreen title={t(full ? "tv.exitFullScreen" : "tv.fullScreen")} onClick={toggleFull} style={btn}>
          {full ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
      </div>
    </div>
  );
}

/** The two subtitle lines. They follow the live text themselves, so only they redraw as words arrive. */
function Subtitles({ article, translations, translationOn, translationExpected, large }: { article: Article; translations: Record<string, string>; translationOn: boolean; translationExpected: boolean; large: boolean }) {
  countRender("TvSubtitles");
  const partial = useLivePartial();
  const error = useLiveError();
  const lastFinal = article.blocks.at(-1)?.sentences.at(-1);
  // When the newest finished sentence (then its translation) arrived: it stays a moment before the preview replaces it.
  const arrived = useRef<{ text: string; at: number; translated: boolean } | null>(null);
  const translated = Boolean(lastFinal && translations[lastFinal]);
  if (!lastFinal) arrived.current = null;
  else if (arrived.current?.text !== lastFinal) arrived.current = { text: lastFinal, at: Date.now(), translated };
  else if (translated && !arrived.current.translated) arrived.current = { ...arrived.current, at: Date.now(), translated };
  const waiting = translationOn && translationExpected && !translated;
  const last = arrived.current && { text: arrived.current.text, at: arrived.current.at, waiting };
  const [, tick] = useState(0);
  const at = last?.at;
  useEffect(() => {
    if (!last) return;
    const left = last.at + Math.max(subtitleHold(last.text), waiting ? SUBTITLE_WAIT_MAX : 0) - Date.now();
    if (left <= 0) return;
    const t = window.setTimeout(() => tick((n) => n + 1), left + 20);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, waiting]);

  const view = error ? { text: error, final: false } : subtitleView(previewParagraph(partial, lastFinal), last, Date.now());
  const content = languageScope(article.language);
  const translation = view.final && translationOn ? translations[view.text] : undefined;
  if (!view.text) return null;
  return (
    <div data-tv-subtitles-box style={{ position: "absolute", left: "6%", right: "6%", bottom: large ? "7%" : "6%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, pointerEvents: "none" }}>
      <div
        data-tv-subtitle-original
        data-final={view.final ? "" : undefined}
        // Only a finished sentence is one the right-click menu may add (words still being heard never are).
        data-sentence-key={view.final ? "tv-subtitle" : undefined}
        dir={content.dir}
        lang={article.language}
        style={{ background: "rgba(20,19,17,0.72)", color: "#FAFAF7", padding: "3px 10px", borderRadius: 4, fontFamily: content.fontOver(UI_FONT), fontSize: large ? 30 : 18, lineHeight: 1.4, textAlign: "center", opacity: view.final ? 1 : 0.6, transition: "opacity 0.3s ease", maxWidth: "100%", pointerEvents: "auto", userSelect: "text", cursor: "text" }}
      >
        {view.text}
      </div>
      {view.final && translationOn && (translation || translationExpected) && (
        <div data-tv-subtitle-translation dir="auto" style={{ background: "rgba(20,19,17,0.62)", color: "#E5E2D9", padding: "2px 10px", borderRadius: 4, fontSize: large ? 22 : 14, lineHeight: 1.4, textAlign: "center", maxWidth: "100%" }}>
          {translation || "…"}
        </div>
      )}
    </div>
  );
}
