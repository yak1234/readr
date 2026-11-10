import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Article, Block } from "../../shared/types";
import { tokenizeWithOffsets } from "../../shared/segment";
import { pendingMark } from "../../shared/live";
import { visibleRange, type Range } from "../lib/virtual";
import { useTranslation } from "react-i18next";
import { languageScope, type LanguageScopeValue } from "../lib/language-scope";
import { fontFamilyMap, FocusMode, ReadingFont, ReadingTokens, UI_FONT, ViewMode } from "../lib/theme";

export interface WordClick {
  word: string;
  sentence: string;
  /** Where the word sits in `sentence` (UTF-16 offsets), when known. */
  span?: [number, number];
  rect: DOMRect;
  /** The sentence's key ("block:sentence"), when clicked in the text. */
  sentenceKey?: string;
}

interface Props {
  article: Article;
  mode: ViewMode;
  /** The language translations are in (the bilingual view's second column). */
  targetLang: string;
  translations: Record<string, string>;
  blurTranslation: boolean;
  fontSize: number;
  font: ReadingFont;
  tokens: ReadingTokens;
  focusMode: FocusMode;
  /** Sentence key ("block:sentence") currently read aloud. */
  activeKey: string | null;
  onWord: (click: WordClick) => void;
  onReadFrom: (key: string) => void;
  /** A very long transcript (live radio, Unlimited): draw only the blocks near
   * the viewport of this scrolling element. */
  virtualize?: boolean;
  scrollEl?: React.RefObject<HTMLElement | null>;
  /** Live transcript: sentences / translations that just arrived fade in. */
  freshSentences?: { has(k: string): boolean };
  freshTranslations?: { has(k: string): boolean };
  /** A translation is on its way (not unavailable, not failed). */
  translationExpected?: boolean;
  /** Drawn after the last block, inside the transcript (a live preview). */
  tail?: React.ReactNode;
  /** Controls under the header's byline (a live transcript's Earlier, a past one's Back to live). */
  headerActions?: React.ReactNode;
}

/** Below this many blocks everything is drawn. */
const VIRTUAL_FROM = 30;
const ESTIMATE = 160; // px for a block not measured yet
const OVERSCAN = 1200;

export const sentenceKey = (b: number, s: number) => `${b}:${s}`;

export function ReaderView(props: Props) {
  const { article, mode, tokens, font, fontSize, focusMode } = props;
  const content = languageScope(article.language);
  const body = Math.round(19 * (fontSize / 100));
  const fontFamily = content.fontOver(fontFamilyMap[font]);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [rulerY, setRulerY] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const focusKey = focusMode === "sentence" ? props.activeKey ?? hoverKey : null;
  const wide = mode === "bilingual";

  const ctx: SentenceCtx = { ...props, body, fontFamily, focusKey, setHoverKey };
  const virt = Boolean(props.virtualize && props.scrollEl) && article.blocks.length > VIRTUAL_FROM;
  const { range, bodyRef, measure } = useVirtualBlocks(virt, article, props.scrollEl);

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => {
        if (focusMode !== "line" || !containerRef.current) return;
        const box = containerRef.current.getBoundingClientRect();
        setRulerY(e.clientY - box.top);
      }}
      onMouseLeave={() => setRulerY(null)}
      style={{ position: "relative", background: tokens.bg, color: tokens.text, minHeight: "100%", transition: "background 0.3s ease, color 0.3s ease" }}
    >
      <div style={{ maxWidth: wide ? 1120 : 700, margin: "0 auto", padding: "48px 48px 120px" }}>
        <ArticleHeader article={article} tokens={tokens} body={body} fontFamily={fontFamily} content={content} translations={mode === "original" ? null : props.translations} actions={props.headerActions} />

        <div ref={bodyRef} dir={content.dir} lang={article.language} className="readr-body">
          {mode === "bilingual" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px", marginBottom: 12, fontFamily: UI_FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: tokens.secondary }}>
              <div data-bilingual-original>{content.native}</div>
              <div data-bilingual-target>{languageScope(props.targetLang).native}</div>
            </div>
          )}
          {virt ? (
            <>
              <div style={{ height: range.before }} />
              {article.blocks.slice(range.from, range.to).map((block, k) => {
                const b = range.from + k;
                return (
                  <div key={b} data-vb={b} ref={measure} style={{ display: "flow-root" }}>
                    <BlockView block={block} b={b} ctx={ctx} first={b === firstParagraphIndex(article.blocks)} />
                  </div>
                );
              })}
              <div style={{ height: range.after }} />
            </>
          ) : (
            article.blocks.map((block, b) => <BlockView key={b} block={block} b={b} ctx={ctx} first={b === firstParagraphIndex(article.blocks)} />)
          )}
          {props.tail}
        </div>
      </div>

      {focusMode === "line" && rulerY !== null && <ReadingRuler y={rulerY} height={body * 2.1} bg={tokens.bg} />}
    </div>
  );
}

/** Which blocks to draw for a long transcript, from the scroll position and the
 * heights measured so far (a guess for blocks not drawn yet). */
function useVirtualBlocks(virt: boolean, article: Article, scrollEl?: React.RefObject<HTMLElement | null>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<number, number>());
  const [range, setRange] = useState<Range>({ from: 0, to: VIRTUAL_FROM, before: 0, after: 0 });
  const n = article.blocks.length;

  const recompute = useCallback(() => {
    const sc = scrollEl?.current;
    const body = bodyRef.current;
    if (!sc || !body) return;
    const known = [...heights.current.values()];
    const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : ESTIMATE;
    const hs = Array.from({ length: n }, (_, i) => heights.current.get(i) ?? avg);
    const bodyTop = body.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const top = sc.scrollTop - bodyTop;
    const r = visibleRange(hs, top, top + sc.clientHeight, OVERSCAN);
    setRange((old) => (old.from === r.from && old.to === r.to && Math.abs(old.before - r.before) < 1 && Math.abs(old.after - r.after) < 1 ? old : r));
  }, [n, scrollEl]);

  useEffect(() => {
    heights.current.clear();
  }, [article.id, virt]);

  useEffect(() => {
    const sc = scrollEl?.current;
    if (!virt || !sc) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    recompute();
    return () => {
      cancelAnimationFrame(frame);
      sc.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [virt, recompute, scrollEl]);

  // Remember what the drawn blocks measure; redo the range if a guess was off.
  const measured = useRef<Set<HTMLElement>>(new Set());
  const measure = useCallback((el: HTMLElement | null) => {
    if (el) measured.current.add(el);
  }, []);
  useLayoutEffect(() => {
    if (!virt) return;
    let changed = false;
    for (const el of measured.current) {
      if (!el.isConnected) {
        measured.current.delete(el);
        continue;
      }
      const b = Number(el.dataset.vb);
      const h = el.getBoundingClientRect().height;
      if (Math.abs((heights.current.get(b) ?? -10) - h) > 1) {
        heights.current.set(b, h);
        changed = true;
      }
    }
    if (changed) recompute();
  });

  return { range: virt ? range : { from: 0, to: n, before: 0, after: 0 }, bodyRef, measure };
}

function firstParagraphIndex(blocks: Block[]) {
  return blocks.findIndex((b) => b.type === "p");
}

interface SentenceCtx extends Props {
  body: number;
  fontFamily: string;
  focusKey: string | null;
  setHoverKey: (k: string | null) => void;
}

function BlockView({ block, b, ctx, first }: { block: Block; b: number; ctx: SentenceCtx; first: boolean }) {
  const { mode, tokens, body, fontFamily, translations } = ctx;
  const isHeading = block.type === "h";
  const size = isHeading ? Math.round(body * 1.25) : body;
  const textStyle: React.CSSProperties = {
    fontFamily,
    fontSize: size,
    fontWeight: isHeading ? 600 : 400,
    lineHeight: isHeading ? 1.35 : 1.75,
    color: tokens.text,
    fontStyle: block.type === "q" ? "italic" : "normal",
  };
  const wrapper: React.CSSProperties = {
    marginBottom: isHeading ? 14 : 24,
    marginTop: isHeading ? 36 : 0,
    ...(block.type === "q" ? { borderLeft: `2px solid ${tokens.border}`, paddingLeft: 18 } : {}),
    ...(block.type === "li" ? { paddingLeft: 18, position: "relative" as const } : {}),
  };
  const bullet = block.type === "li" ? <span style={{ position: "absolute", left: 2, color: tokens.secondary }}>•</span> : null;
  const translationStyle: React.CSSProperties = {
    fontFamily,
    fontSize: Math.round(size * 0.82),
    lineHeight: 1.55,
    color: tokens.secondary,
    fontStyle: "italic",
  };

  if (mode === "original") {
    return (
      <div style={wrapper}>
        {bullet}
        <p className={first ? "readr-dropcap" : undefined} style={{ ...textStyle, margin: 0 }}>
          {block.sentences.map((s, i) => (
            <React.Fragment key={i}>
              <Sentence text={s} k={sentenceKey(b, i)} ctx={ctx} />
              {i < block.sentences.length - 1 ? " " : null}
            </React.Fragment>
          ))}
        </p>
      </div>
    );
  }

  if (mode === "translation") {
    return (
      <div style={wrapper}>
        {bullet}
        <p style={{ ...textStyle, margin: 0 }}>
          {block.sentences.map((s, i) => (
            <span key={i} title={s} style={{ opacity: dim(ctx, sentenceKey(b, i)) }}>
              {tr(ctx, s, "60%")}
              {i < block.sentences.length - 1 ? " " : null}
            </span>
          ))}
        </p>
      </div>
    );
  }

  if (mode === "bilingual") {
    return (
      <div style={{ ...wrapper, paddingLeft: 0, borderLeft: "none" }}>
        {block.sentences.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px", marginBottom: 6 }}>
            <div style={textStyle}>
              <Sentence text={s} k={sentenceKey(b, i)} ctx={ctx} />
            </div>
            <div className={ctx.blurTranslation ? "readr-blur" : undefined} style={{ ...textStyle, color: tokens.secondary, opacity: dim(ctx, sentenceKey(b, i)) }}>
              {tr(ctx, s, "80%")}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Interlinear: each sentence followed by its translation.
  return (
    <div style={wrapper}>
      {bullet}
      {block.sentences.map((s, i) => (
        <div key={i} style={{ marginBottom: i < block.sentences.length - 1 ? 12 : 0 }}>
          <div style={textStyle}>
            <Sentence text={s} k={sentenceKey(b, i)} ctx={ctx} />
          </div>
          <div className={ctx.blurTranslation ? "readr-blur" : undefined} style={{ ...translationStyle, marginTop: 2, opacity: dim(ctx, sentenceKey(b, i)) }}>
            {tr(ctx, s, "70%")}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A sentence's translation: faded in when it just arrived, a placeholder while pending. */
function tr(ctx: SentenceCtx, s: string, width: string) {
  const t = ctx.translations[s];
  if (t === undefined) return <Pending width={width} tokens={ctx.tokens} ctx={ctx} />;
  return ctx.freshTranslations?.has(s) ? <span className="readr-arrive">{t}</span> : t;
}

function dim(ctx: SentenceCtx, k: string) {
  return ctx.focusKey && ctx.focusKey !== k ? 0.28 : 1;
}

function Sentence({ text, k, ctx }: { text: string; k: string; ctx: SentenceCtx }) {
  const active = ctx.activeKey === k;
  return (
    <span
      data-key={k}
      data-sentence-key={k}
      data-active={active ? "" : undefined}
      onMouseEnter={() => ctx.setHoverKey(k)}
      onMouseLeave={() => ctx.setHoverKey(null)}
      onClick={(e) => {
        if (e.altKey) ctx.onReadFrom(k); // Alt+click: read aloud from this sentence
      }}
      className={ctx.freshSentences?.has(text) ? "readr-sentence readr-arrive" : "readr-sentence"}
      style={{
        ["--sentence-hover" as string]: ctx.tokens.sentenceHover,
        background: active ? ctx.tokens.activeSentence : undefined,
        borderRadius: 3,
        opacity: dim(ctx, k),
        transition: "opacity 0.2s, background 0.2s",
      }}
    >
      <SentenceWords text={text} k={k} onWord={ctx.onWord} />
    </span>
  );
}

/** A sentence's words, each opening the word popup on a click (not at the end of a drag, nor with Alt,
 * which is the sentence's). Drawn inside the element carrying the sentence's `data-sentence-key`. */
export function SentenceWords({ text, k, onWord }: { text: string; k: string; onWord: (click: WordClick) => void }) {
  const toks = useMemo(() => tokenizeWithOffsets(text), [text]);
  return (
    <>
      {toks.map((t, i) =>
        t.isWord ? (
          <span
            key={i}
            className="readr-word"
            onClick={(e) => {
              if (e.altKey) return; // let the sentence handle Alt+click
              e.stopPropagation();
              if (!window.getSelection()?.isCollapsed) return; // the end of a drag that selects text
              const word = t.text.replace(/['’]$/, "");
              onWord({ word, sentence: text, span: [t.start, t.start + word.length], rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), sentenceKey: k });
            }}
          >
            {t.text}
          </span>
        ) : (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function Pending({ width, tokens, ctx }: { width: string; tokens: ReadingTokens; ctx: SentenceCtx }) {
  // A live transcript shows a faint "…" until the translation arrives, and
  // nothing when none is coming.
  const mark = pendingMark(Boolean(ctx.article.live), ctx.translationExpected);
  if (mark === "none") return null;
  if (mark === "dots") return <span style={{ opacity: 0.4 }}>…</span>;
  return <span className="readr-shimmer" style={{ display: "inline-block", width, height: "0.7em", borderRadius: 3, background: tokens.border, verticalAlign: "middle" }} />;
}

function ArticleHeader({
  actions,
  article,
  tokens,
  body,
  fontFamily,
  content,
  translations,
}: {
  article: Article;
  tokens: ReadingTokens;
  body: number;
  fontFamily: string;
  content: LanguageScopeValue;
  translations: Record<string, string> | null;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [imgOk, setImgOk] = useState(true);
  const titleTranslation = translations?.[article.title];
  // Set larger (Arabic): no negative tracking, taller lines, no italic.
  const large = content.contentScale > 1;
  return (
    <header>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div dir="auto" lang={article.language} style={{ display: "inline-block", fontSize: 22, fontFamily: content.contentFont, color: tokens.text, letterSpacing: "-0.5px", fontWeight: 600, opacity: 0.85 }}>
          {article.source}
        </div>
      </div>

      {/* The article's own words: its language and direction, which the title and standfirst inherit. */}
      <div data-article-content dir={content.dir} lang={article.language}>
      <h1
        style={{
          fontFamily,
          fontSize: Math.round(body * 2.1),
          fontWeight: 600,
          lineHeight: large ? 1.6 : 1.18,
          color: tokens.text,
          textAlign: "start",
          margin: "0 0 10px",
          letterSpacing: large ? 0 : "-0.5px",
        }}
      >
        {article.title}
      </h1>
      </div>
      {titleTranslation && (
        <div dir="auto" style={{ fontFamily, fontSize: Math.round(body * 1.05), fontStyle: "italic", color: tokens.secondary, marginBottom: 14, textAlign: "start" }}>{titleTranslation}</div>
      )}

      {article.subtitle && (
        <p
          data-article-subtitle
          dir={content.dir}
          lang={article.language}
          style={{
            fontFamily,
            fontSize: Math.round(body * 1.05),
            fontStyle: large ? "normal" : "italic",
            textAlign: "start",
            color: tokens.secondary,
            lineHeight: 1.5,
            margin: "0 0 20px",
            borderBottom: `1px solid ${tokens.border}`,
            paddingBottom: 20,
          }}
        >
          {article.subtitle}
        </p>
      )}

      {/* Chrome: English, left to right; the author and date inside it are isolated content. */}
      <div data-article-byline dir="ltr" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, fontSize: 12, fontFamily: UI_FONT, color: tokens.secondary, flexWrap: "wrap" }}>
        {article.live && !article.past && <span data-live-label style={{ fontWeight: 500, color: tokens.text }}>{t("reader.live")}</span>}
        {article.author && <span style={{ fontWeight: 500, color: tokens.text }}>{t("reader.by", { author: article.author })}</span>}
        {article.author && article.date && <span style={{ opacity: 0.4 }}>·</span>}
        {article.date && <span dir="auto">{article.date}</span>}
        {!article.live && <span style={{ opacity: 0.4 }}>·</span>}
        {!article.live && <span>{t("reader.readTime", { minutes: article.readingTime })}</span>}
      </div>
      {actions && (
        <div data-header-actions style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "-14px 0 28px", fontFamily: UI_FONT }}>
          {actions}
        </div>
      )}

      {article.imageUrl && imgOk && (
        <div style={{ marginBottom: 32, borderRadius: 4, overflow: "hidden", aspectRatio: "16/9", background: tokens.border }}>
          <img src={article.imageUrl} alt="" onError={() => setImgOk(false)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </div>
      )}
    </header>
  );
}

function ReadingRuler({ y, height, bg }: { y: number; height: number; bg: string }) {
  const top = Math.max(0, y - height / 2);
  const veil = { position: "absolute" as const, left: 0, right: 0, background: bg, opacity: 0.72, pointerEvents: "none" as const };
  return (
    <>
      <div style={{ ...veil, top: 0, height: top }} />
      <div style={{ ...veil, top: top + height, bottom: 0 }} />
    </>
  );
}
