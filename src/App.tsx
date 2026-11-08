import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Moon, Sun, PanelRight } from "lucide-react";
import type { Article, ArticleSummary, Feed, SidecarStatus, Site, VideoKey, VideoState, VocabEntry } from "../shared/types";
import { cueAt } from "../shared/captions";
import { api } from "./lib/api";
import { useSettings } from "./lib/settings";
import { chromeTokens, readingTokens, UI_FONT, ViewMode } from "./lib/theme";
import { useSentenceReader, useVoices } from "./lib/speech";
import { LeftSidebar, FeedState } from "./components/left-sidebar";
import { ReaderView, sentenceKey, WordClick } from "./components/reader-view";
import { RightPanel } from "./components/right-panel";
import { DictionaryPopup } from "./components/dictionary-popup";
import { AudioPlayer } from "./components/audio-player";
import { VocabularyView } from "./components/vocabulary-view";
import { useVideoState, VideoStage } from "./components/video-stage";

type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; url: string }
  | { kind: "error"; url: string; message: string }
  | { kind: "paywall"; url: string; preview: Article; site: Site | undefined };

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "interlinear", label: "Interlinear" },
  { id: "bilingual", label: "Bilingual" },
  { id: "translation", label: "Translation" },
];

const LEFT_W = 220;
const RIGHT_W = 210;

export default function App() {
  const [settings, update] = useSettings();
  const c = chromeTokens(settings.readingStyle);
  const tokens = readingTokens[settings.readingStyle];

  const [sites, setSites] = useState<Site[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedState, setFeedState] = useState<Record<string, FeedState>>({});
  const [library, setLibrary] = useState<ArticleSummary[]>([]);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [section, setSection] = useState("feed:lemonde-une");
  const [article, setArticle] = useState<Article | null>(null);
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [popup, setPopup] = useState<WordClick | null>(null);
  const [listening, setListening] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [loopIndex, setLoopIndex] = useState<number | null>(null);
  const [videoOverlay, setVideoOverlay] = useState(true);
  const mainRef = useRef<HTMLElement>(null);

  // ---------- bootstrapping ----------
  const refreshLibrary = useCallback(() => api.library().then(setLibrary).catch(() => undefined), []);
  const refreshVocab = useCallback(() => api.vocab().then(setVocab).catch(() => undefined), []);

  const loadFeed = useCallback((feedId: string) => {
    setFeedState((s) => ({ ...s, [feedId]: { loading: true, items: s[feedId]?.items ?? [] } }));
    api.fetchFeed(feedId).then(
      (r) => setFeedState((s) => ({ ...s, [feedId]: { loading: false, items: r.items, error: r.ok ? undefined : r.error } })),
      (e) => setFeedState((s) => ({ ...s, [feedId]: { loading: false, items: [], error: String(e?.message ?? e) } })),
    );
  }, []);

  useEffect(() => {
    api.sites().then(setSites).catch(() => undefined);
    api.feeds().then(setFeeds).catch(() => undefined);
    refreshLibrary();
    refreshVocab();
  }, [refreshLibrary, refreshVocab]);

  useEffect(() => {
    if (section.startsWith("feed:") && !feedState[section.slice(5)]) loadFeed(section.slice(5));
  }, [section, feedState, loadFeed]);

  // Poll the translation engine: quickly until it is up, then occasionally.
  useEffect(() => {
    let timer: number;
    const tick = async () => {
      const s = await api.sidecarStatus().catch(() => null);
      setStatus(s);
      timer = window.setTimeout(tick, s?.ok ? 30_000 : 4_000);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  // ---------- opening articles ----------
  const showArticle = useCallback((a: Article) => {
    setArticle(a);
    setTranslations(a.translations ?? {});
    setTranslateError(null);
    setPopup(null);
    setListening(false);
    setVideoState(null);
    setLoopIndex(null);
    setProgress(a.progress ?? 0);
    setLoad({ kind: "idle" });
    requestAnimationFrame(() => {
      const el = mainRef.current;
      if (el) el.scrollTop = ((a.progress ?? 0) / 100) * (el.scrollHeight - el.clientHeight);
    });
  }, []);

  const openUrl = useCallback(
    async (url: string) => {
      setLoad({ kind: "loading", url });
      setPopup(null);
      if (section === "vocabulary") setSection("reading-list");
      const r = await api.extract(url).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
      if (!r.ok || !("article" in r) || !r.article) {
        setLoad({ kind: "error", url, message: ("error" in r && r.error) || "Could not read this page." });
        return;
      }
      if (r.paywalled) {
        const host = new URL(url).hostname;
        setLoad({ kind: "paywall", url, preview: r.article, site: sites.find((s) => s.hosts.some((h) => host.endsWith(h))) });
        return;
      }
      showArticle(r.article);
      refreshLibrary();
    },
    [section, sites, showArticle, refreshLibrary],
  );

  const login = useCallback(
    async (siteId: string) => {
      await api.login(siteId);
      // After the sign-in window closes, refresh what depends on the session.
      setFeedState({});
      if (load.kind === "paywall" || load.kind === "error") openUrl(load.url);
    },
    [load, openUrl],
  );

  // ---------- translation ----------
  const allSentences = useMemo(() => {
    if (!article) return [] as string[];
    const list = [article.title, ...article.blocks.flatMap((b) => b.sentences)];
    return [...new Set(list.filter(Boolean))];
  }, [article]);

  useEffect(() => {
    if (!article || settings.viewMode === "original") return;
    const missing = allSentences.filter((s) => !(s in translations));
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const CHUNK = 32; // small chunks so the first screen fills in quickly
      for (let i = 0; i < missing.length && !cancelled; i += CHUNK) {
        try {
          const out = await api.translate(article.id, missing.slice(i, i + CHUNK));
          if (cancelled) return;
          setTranslations((t) => ({ ...t, ...out }));
          setTranslateError(null);
        } catch (e) {
          if (!cancelled) setTranslateError("The translation engine isn't running yet. Translations will appear once it starts.");
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the engine comes online, too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, settings.viewMode, allSentences, status?.ok]);

  // ---------- reading progress ----------
  const saveTimer = useRef<number | undefined>(undefined);
  const onScroll = () => {
    const el = mainRef.current;
    if (!el || !article) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((el.scrollTop / max) * 100))) : 100;
    setProgress(pct);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      api.updateArticle(article.id, { progress: pct }).then(refreshLibrary).catch(() => undefined);
    }, 1500);
  };

  // ---------- read aloud ----------
  const flat = useMemo(() => {
    if (!article) return { keys: [] as string[], sentences: [] as string[] };
    const keys: string[] = [];
    const sentences: string[] = [];
    article.blocks.forEach((b, bi) => b.sentences.forEach((s, si) => {
      keys.push(sentenceKey(bi, si));
      sentences.push(s);
    }));
    return { keys, sentences };
  }, [article]);

  const voices = useVoices(article?.language ?? "fr");
  const reader = useSentenceReader({
    sentences: flat.sentences,
    lang: article?.language ?? "fr",
    rate: settings.speechRate,
    voiceURI: settings.voiceURI,
    onFinished: useCallback(() => undefined, []),
  });
  // ---------- video ----------
  const isVideo = article?.kind === "video" && Boolean(article.videoId);
  const flatCues = useMemo(
    () => (article?.cues ?? []).flat().map(([start, end]) => ({ text: "", start, end })),
    [article],
  );
  useVideoState(isVideo, setVideoState);
  const videoIndex = isVideo && videoState && !videoState.ad ? cueAt(flatCues, videoState.time) : -1;

  const seekToSentence = useCallback(
    (i: number, mode: "play" | "once" = "play") => {
      const cue = flatCues[Math.min(Math.max(i, 0), flatCues.length - 1)];
      if (!cue) return;
      if (mode === "once") api.videoPlayRange(cue.start, cue.end);
      else api.videoSeek(cue.start, true);
    },
    [flatCues],
  );

  const onVideoKey = useCallback(
    (k: VideoKey) => {
      const i = Math.max(0, videoIndex);
      if (k === "prev") seekToSentence(videoIndex <= 0 ? 0 : i - 1);
      else if (k === "next") seekToSentence(i + 1);
      else if (k === "repeat") seekToSentence(i, "once");
      else if (k === "slower") api.videoRate(-0.25);
      else if (k === "faster") api.videoRate(0.25);
      else if (k === "toggle") api.videoToggle();
    },
    [videoIndex, seekToSentence],
  );
  const onVideoKeyRef = useRef(onVideoKey);
  onVideoKeyRef.current = onVideoKey;
  useEffect(() => (isVideo ? api.onVideoKey((k) => onVideoKeyRef.current(k)) : undefined), [isVideo]);

  // Loop: when the looped sentence ends, go back to its start.
  useEffect(() => {
    if (loopIndex === null || !videoState || videoState.paused) return;
    const cue = flatCues[loopIndex];
    if (cue && (videoState.time >= cue.end || videoState.time < cue.start - 1)) api.videoSeek(cue.start, true);
  }, [loopIndex, videoState, flatCues]);

  // Two-line subtitles drawn on the video itself (visible in fullscreen too).
  const overlaySentence = videoIndex >= 0 ? flat.sentences[videoIndex] ?? "" : "";
  const overlayTranslation = overlaySentence ? translations[overlaySentence] ?? "" : "";
  useEffect(() => {
    if (!isVideo) return;
    api.videoOverlay(videoOverlay ? overlaySentence : "", videoOverlay && settings.viewMode !== "original" ? overlayTranslation : "");
  }, [isVideo, videoOverlay, overlaySentence, overlayTranslation, settings.viewMode]);

  const activeKey = isVideo
    ? (videoIndex >= 0 ? flat.keys[videoIndex] ?? null : null)
    : listening
      ? flat.keys[reader.index] ?? null
      : null;

  useEffect(() => {
    if (!activeKey) return;
    document.querySelector(`[data-key="${activeKey}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeKey]);

  const remainingSeconds = useMemo(() => {
    const words = flat.sentences.slice(reader.index).join(" ").split(/\s+/).length;
    return (words / (160 * settings.speechRate)) * 60;
  }, [flat.sentences, reader.index, settings.speechRate]);

  const toggleListen = () => {
    if (listening) {
      reader.pause();
      setListening(false);
    } else {
      setListening(true);
      reader.play();
    }
  };

  // ---------- article actions ----------
  const patchArticle = (patch: Partial<Article>) => {
    if (!article) return;
    setArticle({ ...article, ...patch });
    api.updateArticle(article.id, patch).then(refreshLibrary).catch(() => undefined);
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable || e.metaKey || e.ctrlKey) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) update("viewMode", VIEW_MODES[idx].id);
      if (e.key === "f") update("focusMode", settings.focusMode === "article" ? "off" : "article");
      const videoKeys: Record<string, VideoKey> = { a: "prev", d: "next", s: "repeat", "[": "slower", "]": "faster", k: "toggle" };
      if (isVideo && videoKeys[e.key.toLowerCase()]) {
        e.preventDefault();
        onVideoKeyRef.current(videoKeys[e.key.toLowerCase()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update, settings.focusMode, isVideo]);

  // ---------- layout ----------
  const distractionFree = settings.focusMode === "article";
  const showLeft = !distractionFree;
  const showRight = !distractionFree && settings.showRightPanel;
  const dark = settings.readingStyle === "dark";
  const topbarBg = dark ? "#1E1D1A" : "#F2F0EB";
  const topbarBorder = dark ? "#3E3C38" : "#E5E2D9";
  const topbarText = dark ? "#E8E6E0" : "#1C1B18";
  const topbarMuted = dark ? "#6B6963" : "#9E9C97";
  const selectedUrl = load.kind !== "idle" ? load.url : article?.url ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", fontFamily: UI_FONT, background: tokens.bg, color: tokens.text, transition: "background 0.3s ease" }}>
      {/* Title bar */}
      <div className="readr-drag" style={{ height: 44, display: "flex", alignItems: "center", background: topbarBg, borderBottom: `1px solid ${topbarBorder}`, flexShrink: 0, zIndex: 40 }}>
        <div style={{ width: showLeft ? LEFT_W : 120, minWidth: showLeft ? LEFT_W : 120 }} />
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          {article && section !== "vocabulary" && (
            <div className="readr-no-drag" style={{ display: "flex", gap: 2, background: dark ? "#2A2825" : "#ECEAE4", borderRadius: 6, padding: 3 }}>
              {VIEW_MODES.map((m, i) => {
                const on = settings.viewMode === m.id;
                return (
                  <button
                    key={m.id}
                    title={`${m.label} (${i + 1})`}
                    onClick={() => update("viewMode", m.id)}
                    style={{
                      padding: "3px 12px",
                      borderRadius: 4,
                      border: "none",
                      background: on ? (dark ? "#3E3C38" : "#FAFAF7") : "transparent",
                      fontSize: 11,
                      fontWeight: on ? 500 : 400,
                      color: on ? topbarText : topbarMuted,
                      cursor: "pointer",
                      fontFamily: UI_FONT,
                      boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    }}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="readr-no-drag" style={{ width: showRight ? RIGHT_W : 210, minWidth: 210, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, gap: 4 }}>
          {article && !isVideo && section !== "vocabulary" && (
            <button
              onClick={toggleListen}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 5, border: `1px solid ${topbarBorder}`, background: listening ? topbarText : "transparent", color: listening ? topbarBg : topbarMuted, fontSize: 11, cursor: "pointer", fontFamily: UI_FONT }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              {listening ? "Stop" : "Listen"}
            </button>
          )}
          {article && (
            <div style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${topbarBorder}`, fontSize: 11, color: topbarMuted, letterSpacing: "0.03em" }}>
              {article.language === "ar" ? "عربي" : article.language.toUpperCase()}
            </div>
          )}
          <button title="Dark mode" onClick={() => update("readingStyle", dark ? "light" : "dark")} style={{ background: "none", border: "none", cursor: "pointer", color: topbarMuted, padding: 6, display: "flex" }}>
            {dark ? <Sun size={15} strokeWidth={1.8} /> : <Moon size={15} strokeWidth={1.8} />}
          </button>
          <button
            title={distractionFree ? "Exit focus (f)" : "Reading settings"}
            onClick={() => (distractionFree ? update("focusMode", "off") : update("showRightPanel", !settings.showRightPanel))}
            style={{ background: "none", border: "none", cursor: "pointer", color: topbarMuted, padding: "4px 6px", fontFamily: "Georgia, serif", fontSize: 13, display: "flex", alignItems: "center" }}
          >
            {distractionFree ? <PanelRight size={15} strokeWidth={1.8} /> : "Aa"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {showLeft && (
          <LeftSidebar
            c={c}
            section={section}
            onSectionChange={setSection}
            library={library}
            feeds={feeds}
            feedState={feedState}
            onRefreshFeed={loadFeed}
            selectedUrl={selectedUrl}
            onOpenUrl={openUrl}
            vocabCount={vocab.length}
          />
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {isVideo && article && section !== "vocabulary" && load.kind === "idle" && (
          <VideoStage
            article={article}
            tokens={tokens}
            dark={dark}
            wide={settings.viewMode === "bilingual"}
            state={videoState}
            index={videoIndex}
            total={flatCues.length}
            looping={loopIndex !== null}
            overlay={videoOverlay}
            onPrev={() => onVideoKey("prev")}
            onNext={() => onVideoKey("next")}
            onRepeat={() => onVideoKey("repeat")}
            onToggleLoop={() => setLoopIndex(loopIndex === null ? Math.max(0, videoIndex) : null)}
            onToggleOverlay={() => setVideoOverlay(!videoOverlay)}
          />
        )}
        <main ref={mainRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", background: tokens.bg, paddingBottom: listening ? 70 : 0, transition: "background 0.3s ease" }}>
          {section === "vocabulary" ? (
            <VocabularyView
              c={c}
              tokens={tokens}
              vocab={vocab}
              voiceURI={settings.voiceURI}
              onRemove={(id) => api.removeVocab(id).then(refreshVocab)}
              onExport={() => api.exportVocab()}
              onOpen={openUrl}
            />
          ) : load.kind === "loading" ? (
            <LoadingArticle tokens={tokens} />
          ) : load.kind === "error" ? (
            <Notice tokens={tokens} title="Couldn't open this article" body={load.message}>
              <NoticeButton tokens={tokens} onClick={() => openUrl(load.url)}>Try again</NoticeButton>
              <NoticeButton tokens={tokens} onClick={() => api.openOriginal(load.url).then(() => openUrl(load.url))}>Open the page</NoticeButton>
            </Notice>
          ) : load.kind === "paywall" ? (
            <Notice
              tokens={tokens}
              title={`You don't seem to be signed in${load.site ? ` to ${load.site.name}` : ""}`}
              body="Readr only got the free preview of this article. Sign in once in the window that opens, close it, and Readr will fetch the full text."
            >
              {load.site && <NoticeButton tokens={tokens} primary onClick={() => login(load.site!.id)}>Sign in to {load.site.name}</NoticeButton>}
              <NoticeButton tokens={tokens} onClick={() => openUrl(load.url)}>Try again</NoticeButton>
              <NoticeButton tokens={tokens} onClick={() => showArticle(load.preview)}>Read the preview</NoticeButton>
            </Notice>
          ) : article ? (
            <>
              {translateError && settings.viewMode !== "original" && (
                <div style={{ maxWidth: 700, margin: "16px auto 0", padding: "8px 14px", borderRadius: 6, fontSize: 12, background: tokens.sentenceHover, color: tokens.secondary }}>
                  {translateError}
                </div>
              )}
              <ReaderView
                article={article}
                mode={settings.viewMode}
                translations={translations}
                blurTranslation={settings.blurTranslation}
                fontSize={settings.fontSize}
                font={settings.font}
                tokens={tokens}
                focusMode={settings.focusMode}
                activeKey={activeKey}
                onWord={setPopup}
                onReadFrom={(key) => {
                  const i = Math.max(0, flat.keys.indexOf(key));
                  if (isVideo) return seekToSentence(i);
                  setListening(true);
                  reader.jumpTo(i);
                }}
              />
            </>
          ) : (
            <EmptyState tokens={tokens} />
          )}
        </main>
        </div>

        {showRight && (
          <RightPanel
            c={c}
            article={article}
            settings={settings}
            update={update}
            readingProgress={progress}
            sites={sites}
            onLogin={login}
            onViewOriginal={() => article && api.openOriginal(article.url)}
            onToggleFavorite={() => patchArticle({ favorite: !article?.favorite })}
            onToggleArchive={() => patchArticle({ archived: !article?.archived })}
            onDelete={() => {
              if (!article) return;
              api.deleteArticle(article.id).then(refreshLibrary);
              setArticle(null);
            }}
            status={status}
            translatedCount={allSentences.filter((s) => translations[s]).length}
          />
        )}
      </div>

      {listening && article && (
        <AudioPlayer
          style={settings.readingStyle}
          source={article.source}
          title={article.title}
          playing={reader.playing}
          index={reader.index}
          total={flat.sentences.length}
          remainingSeconds={remainingSeconds}
          rate={settings.speechRate}
          onRate={(r) => update("speechRate", r)}
          voices={voices}
          voiceURI={settings.voiceURI}
          onVoice={(v) => update("voiceURI", v)}
          onPlay={reader.play}
          onPause={reader.pause}
          onPrev={reader.prev}
          onNext={reader.next}
          left={showLeft ? LEFT_W : 0}
          right={showRight ? RIGHT_W : 0}
        />
      )}

      {popup && article && (
        <DictionaryPopup
          c={c}
          word={popup.word}
          sentence={popup.sentence}
          sentenceTranslation={translations[popup.sentence] ?? ""}
          rect={popup.rect}
          lang={article.language}
          voiceURI={settings.voiceURI}
          onClose={() => setPopup(null)}
          onSave={async ({ word, lemma, gloss }) => {
            // For videos, find the sentence's cue (prefer the one playing now).
            const at = isVideo
              ? flat.sentences[videoIndex] === popup.sentence
                ? videoIndex
                : flat.sentences.indexOf(popup.sentence)
              : -1;
            const cue = at >= 0 ? flatCues[at] : undefined;
            const entry = await api.addVocab({
              word,
              lemma,
              gloss,
              sentence: popup.sentence,
              sentenceTranslation: translations[popup.sentence] ?? "",
              articleUrl: article.url,
              articleTitle: article.title,
              videoTime: cue?.start,
            });
            refreshVocab();
            if (cue && !entry.image) {
              const media = await api.videoCapture(cue.start, cue.end);
              if (media) {
                await api.updateVocab(entry.id, media);
                refreshVocab();
              }
            }
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ tokens }: { tokens: { text: string; secondary: string } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: tokens.text, fontFamily: UI_FONT, textAlign: "center", padding: 40 }}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 600, letterSpacing: "-0.5px", opacity: 0.85, marginBottom: 10 }}>Bonne lecture.</div>
      <div style={{ fontSize: 13, color: tokens.secondary, maxWidth: 380, lineHeight: 1.6 }}>
        Pick a story from Le Monde, Le Figaro or Courrier International on the left, or paste any article or YouTube link. Sign in to your subscriptions once from the right panel.
      </div>
    </div>
  );
}

function LoadingArticle({ tokens }: { tokens: { border: string; secondary: string } }) {
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px" }}>
      <div style={{ textAlign: "center", fontSize: 12, color: tokens.secondary, marginBottom: 32, fontFamily: UI_FONT }}>Opening the article in your session…</div>
      {[95, 80, 0, 100, 100, 92, 70, 0, 100, 96, 88].map((w, i) =>
        w === 0 ? <div key={i} style={{ height: 18 }} /> : <div key={i} className="readr-shimmer" style={{ height: i < 2 ? 26 : 12, width: `${w}%`, background: tokens.border, borderRadius: 3, marginBottom: 12 }} />,
      )}
    </div>
  );
}

function Notice({ tokens, title, body, children }: { tokens: { text: string; secondary: string; border: string }; title: string; body: string; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 520, margin: "12vh auto 0", padding: "0 32px", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 600, letterSpacing: "-0.3px", marginBottom: 10 }}>{title}</div>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: tokens.secondary, margin: "0 0 20px" }}>{body}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function NoticeButton({ tokens, primary, onClick, children }: { tokens: { text: string; border: string }; primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: 6,
        border: `1.5px solid ${primary ? tokens.text : tokens.border}`,
        background: primary ? tokens.text : "transparent",
        color: primary ? "#FAFAF7" : tokens.text,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: UI_FONT,
      }}
    >
      {children}
    </button>
  );
}
