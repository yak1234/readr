import React, { useMemo, useRef, useState } from "react";
import type { Article, Block } from "../../shared/types";
import { tokenize } from "../../shared/segment";
import { ARABIC_FONT, fontFamilyMap, FocusMode, ReadingFont, ReadingTokens, UI_FONT, ViewMode } from "../lib/theme";

export interface WordClick {
  word: string;
  sentence: string;
  rect: DOMRect;
}

interface Props {
  article: Article;
  mode: ViewMode;
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
}

export const sentenceKey = (b: number, s: number) => `${b}:${s}`;

export function ReaderView(props: Props) {
  const { article, mode, tokens, font, fontSize, focusMode } = props;
  const isRTL = article.language === "ar";
  const body = Math.round(19 * (fontSize / 100));
  const fontFamily = isRTL ? ARABIC_FONT : fontFamilyMap[font];
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [rulerY, setRulerY] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const focusKey = focusMode === "sentence" ? props.activeKey ?? hoverKey : null;
  const wide = mode === "bilingual";

  const ctx: SentenceCtx = { ...props, body, fontFamily, focusKey, setHoverKey };

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
        <ArticleHeader article={article} tokens={tokens} body={body} fontFamily={fontFamily} isRTL={isRTL} translations={mode === "original" ? null : props.translations} />

        <div dir={isRTL ? "rtl" : "ltr"} className="readr-body">
          {mode === "bilingual" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 40px", marginBottom: 12, fontFamily: UI_FONT, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: tokens.secondary }}>
              <div>Français</div>
              <div>English</div>
            </div>
          )}
          {article.blocks.map((block, b) => (
            <BlockView key={b} block={block} b={b} ctx={ctx} first={b === firstParagraphIndex(article.blocks)} />
          ))}
        </div>
      </div>

      {focusMode === "line" && rulerY !== null && <ReadingRuler y={rulerY} height={body * 2.1} bg={tokens.bg} />}
    </div>
  );
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
              {translations[s] ?? <Pending width="60%" tokens={tokens} />}
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
              {translations[s] ?? <Pending width="80%" tokens={tokens} />}
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
            {translations[s] ?? <Pending width="70%" tokens={tokens} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function dim(ctx: SentenceCtx, k: string) {
  return ctx.focusKey && ctx.focusKey !== k ? 0.28 : 1;
}

function Sentence({ text, k, ctx }: { text: string; k: string; ctx: SentenceCtx }) {
  const toks = useMemo(() => tokenize(text), [text]);
  const active = ctx.activeKey === k;
  return (
    <span
      data-key={k}
      onMouseEnter={() => ctx.setHoverKey(k)}
      onMouseLeave={() => ctx.setHoverKey(null)}
      onClick={(e) => {
        if (e.altKey) ctx.onReadFrom(k); // Alt+click: read aloud from this sentence
      }}
      className="readr-sentence"
      style={{
        ["--sentence-hover" as string]: ctx.tokens.sentenceHover,
        background: active ? ctx.tokens.activeSentence : undefined,
        borderRadius: 3,
        opacity: dim(ctx, k),
        transition: "opacity 0.2s, background 0.2s",
      }}
    >
      {toks.map((t, i) =>
        t.isWord ? (
          <span
            key={i}
            className="readr-word"
            onClick={(e) => {
              if (e.altKey) return; // let the sentence handle Alt+click
              e.stopPropagation();
              ctx.onWord({ word: t.text.replace(/['’]$/, ""), sentence: text, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
            }}
          >
            {t.text}
          </span>
        ) : (
          <React.Fragment key={i}>{t.text}</React.Fragment>
        ),
      )}
    </span>
  );
}

function Pending({ width, tokens }: { width: string; tokens: ReadingTokens }) {
  return <span className="readr-shimmer" style={{ display: "inline-block", width, height: "0.7em", borderRadius: 3, background: tokens.border, verticalAlign: "middle" }} />;
}

function ArticleHeader({
  article,
  tokens,
  body,
  fontFamily,
  isRTL,
  translations,
}: {
  article: Article;
  tokens: ReadingTokens;
  body: number;
  fontFamily: string;
  isRTL: boolean;
  translations: Record<string, string> | null;
}) {
  const [imgOk, setImgOk] = useState(true);
  const titleTranslation = translations?.[article.title];
  return (
    <header>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ display: "inline-block", fontSize: 22, fontFamily: "Georgia, serif", color: tokens.text, letterSpacing: "-0.5px", fontWeight: 600, opacity: 0.85 }}>
          {article.source}
        </div>
      </div>

      <h1
        style={{
          fontFamily,
          fontSize: Math.round(body * 2.1),
          fontWeight: 600,
          lineHeight: isRTL ? 1.6 : 1.18,
          color: tokens.text,
          textAlign: isRTL ? "right" : "left",
          direction: isRTL ? "rtl" : "ltr",
          margin: "0 0 10px",
          letterSpacing: isRTL ? 0 : "-0.5px",
        }}
      >
        {article.title}
      </h1>
      {titleTranslation && (
        <div style={{ fontFamily, fontSize: Math.round(body * 1.05), fontStyle: "italic", color: tokens.secondary, marginBottom: 14 }}>{titleTranslation}</div>
      )}

      {article.subtitle && (
        <p
          style={{
            fontFamily,
            fontSize: Math.round(body * 1.05),
            fontStyle: isRTL ? "normal" : "italic",
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

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28, fontSize: 12, fontFamily: UI_FONT, color: tokens.secondary, flexWrap: "wrap" }}>
        {article.author && <span style={{ fontWeight: 500, color: tokens.text }}>Par {article.author}</span>}
        {article.author && article.date && <span style={{ opacity: 0.4 }}>·</span>}
        {article.date && <span>{article.date}</span>}
        <span style={{ opacity: 0.4 }}>·</span>
        <span>{article.readingTime} {article.kind === "video" ? "min de vidéo" : "min de lecture"}</span>
      </div>

      {article.imageUrl && imgOk && article.kind !== "video" && (
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
