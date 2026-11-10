import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Languages, Pause, Play, SkipBack, SkipForward, Star, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FloatingState, LookupResult } from "../../shared/types";
import { languageInfo } from "../../shared/languages";
import { tokenizeWithOffsets } from "../../shared/segment";
import { pickGloss, wordIsSaved } from "../../shared/floating";
import { newCardFrom, type ExampleSource } from "../../shared/cards";
import { previewParagraph } from "../../shared/live-transcript";
import { api } from "../lib/api";
import { NOTICES, useSelectionActions } from "../lib/selection-actions";
import { SelectionPopup } from "./selection-popup";
import { Fresh } from "../lib/fresh";
import { countRender } from "../lib/store";
import { languageScope } from "../lib/language-scope";
import { chromeTokens, readingTokens, SERIF, UI_FONT } from "../lib/theme";

const TIP_W = 250;
const TIP_H = 96;

interface Picked {
  word: string;
  sentence: string;
  /** Where the word sits in the sentence (UTF-16 offsets). */
  span: [number, number];
  /** The sentence's live-history id, if it has one. */
  liveId?: string;
  /** The clicked word: the tooltip follows it as the transcript moves. */
  el: HTMLElement;
}

/** The floating window's content: a few sentences that follow whatever is playing
 * (the radio, a TV channel's sound, or the article being read aloud), and a slim, click-only word
 * lookup. Everything it shows comes from the main window. */
export function FloatingPlayer({ state }: { state: FloatingState | null }) {
  countRender("FloatingPlayer");
  const { t } = useTranslation();
  const c = chromeTokens(state?.dark ? "dark" : "light");
  const bg = state?.dark ? "#2A2825" : "#FAFAF7";
  const [picked, setPicked] = useState<Picked | null>(null);
  const [, redraw] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Only what arrives while the window is open fades in.
  const [freshSentences] = useState(() => new Fresh());
  const [freshTranslations] = useState(() => new Fresh());
  const kind = state?.kind ?? null;
  const article = kind === "article";
  // The transcript is the station's or article's language; the header and notes are English chrome.
  const content = languageScope(kind && state ? state.language : "");
  const sentences = state?.sentences ?? [];
  freshSentences.observe(sentences.map((s) => s.text));
  freshTranslations.observe(Object.keys(state?.translations ?? {}));
  const saved = useMemo(() => new Set(state?.savedWords ?? []), [state?.savedWords]);
  const preview = article ? "" : state?.error ?? previewParagraph(state?.partial ?? "", sentences.at(-1)?.text);
  // Where a card added here says its sentence came from.
  const source: ExampleSource | null = state?.kind ? { sourceKind: state.kind, sourceId: state.id || null, sourceTitle: state.title, sourceUrl: state.url } : null;
  // Right-click on selected text: Translate, or Add to flashcards (from a finished sentence only).
  const selection = useSelectionActions({
    lang: state?.language ?? "",
    tgt: state?.target ?? "",
    source,
    sentenceTranslation: (s) => state?.translations[s] ?? "",
    liveSentenceId: (key) => sentences.find((s) => s.key === key)?.liveId,
    highlight: readingTokens[state?.dark ? "dark" : "light"].snapHighlight,
  });

  // Radio follows the newest line, article read-aloud the spoken sentence (the
  // first one shown), unless the reader scrolled back to look at another line, or
  // has a word open (the page doesn't move under the tooltip).
  const spoken = article ? state?.index : undefined;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || picked) return;
    if (article) el.scrollTop = 0;
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [spoken]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && !article && stick.current && !picked) el.scrollTop = el.scrollHeight;
  });

  const send = api.floatingCommand;
  const iconBtn = (on?: boolean): React.CSSProperties => ({ background: on ? c.selected : "none", border: "none", borderRadius: 5, cursor: "pointer", color: on ? c.text : c.body, padding: 5, display: "flex", flexShrink: 0 });

  return (
    <div data-floating style={{ display: "flex", flexDirection: "column", height: "100vh", background: bg, color: c.text, fontFamily: UI_FONT, border: `1px solid ${c.border}`, boxSizing: "border-box", overflow: "hidden" }}>
      <div className="readr-drag" data-fl-header style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 6px 5px 12px", background: c.panel, borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <div data-fl-title style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", unicodeBidi: "plaintext", textAlign: "left" }}>{state?.title || "Readr"}</div>
        {article && state?.total ? <div data-fl-counter style={{ fontSize: 10, color: c.muted, flexShrink: 0, padding: "0 2px" }}>{(state.index ?? 0) + 1}/{state.total}</div> : null}
        {kind && (
          <>
            {article && (
              <button data-fl-prev title={t("floating.previous")} onClick={() => send({ type: "prev" })} style={iconBtn()}>
                <SkipBack size={14} />
              </button>
            )}
            <button data-fl-toggle title={t(state?.playing ? "floating.pause" : "floating.play")} onClick={() => send({ type: "toggle-play" })} style={iconBtn()}>
              {state?.playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            {article && (
              <button data-fl-next title={t("floating.next")} onClick={() => send({ type: "next" })} style={iconBtn()}>
                <SkipForward size={14} />
              </button>
            )}
            <button data-fl-translation title={t(state?.translationOn ? "floating.hideTranslation" : "floating.showTranslation")} aria-pressed={state?.translationOn} onClick={() => send({ type: "toggle-translation" })} style={iconBtn(state?.translationOn)}>
              <Languages size={14} />
            </button>
            <button data-fl-open title={t("floating.open")} onClick={() => send({ type: "open" })} style={iconBtn()}>
              <ExternalLink size={14} />
            </button>
          </>
        )}
        <button data-fl-close title={t("floating.close")} onClick={() => void api.floatingClose()} style={iconBtn()}>
          <X size={14} />
        </button>
      </div>

      <div
        ref={scroller}
        data-fl-body
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          if (picked) redraw((n) => n + 1);
        }}
        dir={content.dir}
        lang={state?.language || undefined}
        style={{ flex: 1, overflowY: "auto", padding: "10px 14px 12px", fontFamily: content.contentFont, fontSize: 15, lineHeight: content.contentScale > 1 ? 1.8 : 1.5 }}
      >
        {!kind && <div dir="ltr" style={{ color: c.muted, fontFamily: UI_FONT, fontSize: 12 }}>{t("floating.nothingPlaying")}</div>}
        {(kind === "radio" || kind === "tv") && sentences.length === 0 && !preview && <div dir="ltr" style={{ color: c.muted, fontFamily: UI_FONT, fontSize: 12 }}>{t(state?.failed ? (kind === "tv" ? "radio.channelUnavailable" : "radio.streamFailed") : "app.listening")}</div>}
        {sentences.map((s, i) => (
          <div key={s.key} data-fl-sentence data-fl-current={article && i === 0 ? "" : undefined} style={{ marginBottom: 8, opacity: article && i > 0 ? 0.6 : 1 }}>
            <div data-sentence-key={s.key} className={freshSentences.has(s.text) ? "readr-arrive" : undefined}>
              <Words text={s.text} saved={saved} picked={picked} onWord={(p) => setPicked({ ...p, ...(s.liveId && { liveId: s.liveId }) })} />
            </div>
            {state?.translationOn && <Translation text={state.translations[s.text]} expected={state.translationExpected} fresh={freshTranslations.has(s.text)} color={c.body} />}
          </div>
        ))}
        {preview && (
          <div data-fl-preview data-sentence-key="live-preview" data-final="false" style={{ opacity: 0.5 }}>
            {preview}
          </div>
        )}
      </div>

      {picked && state && source && (
        <WordTip
          key={`${picked.word}|${picked.sentence}`}
          picked={picked}
          lang={state.language}
          target={state.target}
          sentence={picked.sentence}
          translation={state?.translations[picked.sentence] ?? ""}
          source={source}
          c={c}
          saved={wordIsSaved(saved, picked.word)}
          onClose={() => setPicked(null)}
        />
      )}
      {selection.result && <SelectionPopup c={c} lang={state?.language ?? ""} result={selection.result} onClose={selection.close} />}
    </div>
  );
}

function Translation({ text, expected, fresh, color }: { text: string | undefined; expected: boolean; fresh: boolean; color: string }) {
  if (text === undefined) return expected ? <div style={{ color, opacity: 0.4, fontSize: 12.5, fontFamily: UI_FONT }}>…</div> : null;
  return (
    <div data-fl-translation-line className={fresh ? "readr-arrive" : undefined} dir="ltr" style={{ color, fontSize: 12.5, lineHeight: 1.45, fontFamily: UI_FONT, marginTop: 1 }}>
      {text}
    </div>
  );
}

/** A sentence whose words can be clicked (never hovered). */
function Words({ text, saved, picked, onWord }: { text: string; saved: Set<string>; picked: Picked | null; onWord: (p: Picked) => void }) {
  const toks = useMemo(() => tokenizeWithOffsets(text), [text]);
  return (
    <>
      {toks.map((t, i) => {
        if (!t.isWord) return <React.Fragment key={i}>{t.text}</React.Fragment>;
        const word = t.text.replace(/['’]$/, "");
        const on = picked?.sentence === text && picked.word === word;
        return (
          <span
            key={i}
            data-fl-word
            data-saved={wordIsSaved(saved, word) ? "" : undefined}
            onClick={(e) => window.getSelection()?.isCollapsed !== false && onWord({ word, sentence: text, span: [t.start, t.start + word.length], el: e.currentTarget })}
            style={{ cursor: "pointer", borderRadius: 2, background: on ? "rgba(201,160,96,0.28)" : undefined, textDecoration: wordIsSaved(saved, word) ? "underline dotted" : undefined, textDecorationColor: "rgba(184,169,138,0.9)", textUnderlineOffset: 3 }}
          >
            {t.text}
          </span>
        );
      })}
    </>
  );
}

/** The slim tooltip above a clicked word: dictionary form, one-line gloss, Save and More. */
function WordTip({ picked, lang, target, sentence, translation, source, c, saved, onClose }: { picked: Picked; lang: string; target: string; sentence: string; translation: string; source: ExampleSource; c: ReturnType<typeof chromeTokens>; saved: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<LookupResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [done, setDone] = useState<boolean | "failed">(false);
  const [noAudio, setNoAudio] = useState(false);
  const [saving, setSaving] = useState(false);
  const { word, el } = picked;
  const rect = el.getBoundingClientRect();
  // The word's line left the window (trimmed away): nothing to point at.
  const gone = !el.isConnected || rect.bottom < 0 || rect.top > window.innerHeight;
  useEffect(() => {
    if (gone) onClose();
  });

  useEffect(() => {
    let alive = true;
    api.lookup(word, sentence, lang, target).then(
      (r) => {
        if (!alive) return;
        setResult(r);
        setState(r ? "ready" : "offline");
      },
      () => alive && setState("offline"),
    );
    return () => {
      alive = false;
    };
  }, [word, sentence, lang, target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gloss = pickGloss(result);
  const lemma = result?.lemma && result.lemma.toLowerCase() !== word.toLowerCase() ? result.lemma : "";
  const left = Math.max(6, Math.min(rect.left + rect.width / 2 - TIP_W / 2, window.innerWidth - TIP_W - 6));
  const above = rect.top - TIP_H - 6 >= 30; // below the header
  const style: React.CSSProperties = above ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 };
  const isSaved = saved || done === true;

  const save = async () => {
    if (isSaved || saving) return;
    setSaving(true);
    try {
      const added = await api
        .cardsAdd(newCardFrom({ lang, form: result?.lemma || word, translation: gloss, sentence, sentenceTranslation: translation, source, span: picked.span, liveSentenceId: picked.liveId }))
        .catch(() => null);
      setDone(added ? true : "failed");
      setNoAudio(added?.clip === "unavailable");
    } finally {
      setSaving(false);
    }
  };

  const btn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.text, fontSize: 11, cursor: "pointer", fontFamily: UI_FONT };
  if (gone) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
      <div data-fl-tip role="dialog" dir="ltr" style={{ position: "fixed", left, ...style, width: TIP_W, minHeight: 0, zIndex: 100, padding: "8px 10px", background: c.popup, border: `1px solid ${c.border}`, borderRadius: 8, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", fontFamily: UI_FONT, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span data-fl-tip-word dir="auto" lang={lang} style={{ fontSize: 15, fontWeight: 600, fontFamily: languageScope(lang).contentFont, color: c.text }}>{lemma || word}</span>
          {lemma && <span style={{ fontSize: 11, color: c.muted }}>{t("floating.from", { word })}</span>}
        </div>
        {result && (result.parts?.length ?? 0) > 1 && (
          <div data-fl-tip-parts dir="auto" lang={lang} style={{ fontSize: 11, color: c.muted, fontFamily: languageScope(lang).contentFont, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {result.parts.map((p) => p.text).join(" + ")}
          </div>
        )}
        <div data-fl-tip-gloss style={{ fontSize: 12, color: c.body, margin: "3px 0 7px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: 16 }}>
          {done === "failed" ? <span data-fl-save-failed>{NOTICES.notAdded}</span> : state === "loading" ? "…" : gloss || (state === "offline" ? t("floating.noEntry") : "")}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button data-fl-save onClick={save} disabled={isSaved} style={{ ...btn, background: isSaved ? c.selected : "transparent" }}>
            <Star size={11} fill={isSaved ? "currentColor" : "none"} /> {t(isSaved ? "floating.saved" : "floating.save")}
          </button>
          <button data-fl-more onClick={() => { api.floatingCommand({ type: "more", word, sentence }); onClose(); }} style={btn}>{t("floating.more")}</button>
          {done === true && noAudio && <span data-fl-save-no-audio style={{ alignSelf: "center", fontSize: 11, color: c.muted }}>{NOTICES.noAudio}</span>}
        </div>
      </div>
    </>
  );
}
