// Teleprompter captions beside a TV channel's picture: the newest finished sentence large and solid,
// two earlier ones smaller and fading above it, and the words being heard faint below. Lines settle in
// with CSS transitions only (see .readr-prompt-* in styles.css), and not at all with reduced motion.
//
// Each line is the transcript's own sentence: it carries `data-sentence-key` ("block:sentence") and
// `data-final`, so the word popup, the right-click menu and the live history's sentence id work on it.

import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import type { Article } from "../../shared/types";
import { languageScope } from "../lib/language-scope";
import { useLiveError, useLivePartial } from "../lib/live";
import { countRender } from "../lib/store";
import { newestCues, teleprompterLines, type TeleprompterCue, type TeleprompterLine } from "../lib/teleprompter";
import { fontFamilyMap, UI_FONT, type ReadingFont, type ReadingTokens, type ViewMode } from "../lib/theme";
import { SentenceWords, type WordClick } from "./reader-view";

/** Earlier lines kept above the current one. */
const KEEP = 2;

interface Props {
  article: Article;
  translations: Record<string, string>;
  /** Translations are shown (on, and possible for this pair). */
  translationOn: boolean;
  /** A translation is on its way for a line that has none yet. */
  translationExpected: boolean;
  /** The language translations are in. */
  targetLang: string;
  /** The reader's view: Original shows no translations; Translation leads with them, the original faint. */
  mode: ViewMode;
  /** Translations stay blurred until hovered. */
  blurTranslation: boolean;
  fontSize: number;
  font: ReadingFont;
  tokens: ReadingTokens;
  onWord: (click: WordClick) => void;
}

/** Sizes from the reader's text size: the current line reads at a distance, earlier ones step back. */
function sizes(fontSize: number) {
  const body = 19 * (fontSize / 100);
  return { current: Math.round(body * 1.45), past: Math.round(body * 1.1) };
}

export function Teleprompter(props: Props) {
  countRender("Teleprompter");
  const { article, translations, fontSize, font, tokens } = props;
  const cues = useMemo(() => newestCues(article, translations, KEEP + 1), [article, translations]);
  const content = languageScope(article.language);
  const size = sizes(fontSize);
  return (
    <div
      data-teleprompter
      dir={content.dir}
      lang={article.language}
      // Lines gather at a reading line in the lower middle; older ones fade out into the top edge.
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "hidden", maskImage: "linear-gradient(to bottom, transparent 0, #000 22%)", fontFamily: content.fontOver(fontFamilyMap[font]), color: tokens.text }}
    >
      {/* Screen readers hear each new current line from this one region, which stays put as the lines move. */}
      <VisuallyHidden data-prompt-announcer aria-live="polite">
        {cues.at(-1)?.text ?? ""}
      </VisuallyHidden>
      <PromptLines {...props} cues={cues} />
      <PromptPreview cues={cues} size={size.past} lineHeight={content.contentScale > 1 ? 1.75 : 1.5} tokens={tokens} lang={article.language} />
      <div style={{ flex: "0 1 26%" }} />
    </div>
  );
}

/** The finished lines. They change only when a sentence or a translation arrives, not with the words being heard. */
const PromptLines = memo(function PromptLines({ cues, translations: _translations, ...line }: Props & { cues: TeleprompterCue[] }) {
  countRender("TeleprompterLines");
  const { past, current } = teleprompterLines(cues, "", KEEP);
  const lines = current ? [...past, current] : past;
  return lines.map((l) => <PromptLine key={l.id} line={l} isCurrent={l === current} {...line} />);
});

function PromptLine({ line, isCurrent, article, translationOn, translationExpected, targetLang, mode, blurTranslation, fontSize, font, tokens, onWord }: Omit<Props, "translations"> & { line: TeleprompterLine; isCurrent: boolean }) {
  const content = languageScope(article.language);
  const target = languageScope(targetLang);
  const size = sizes(fontSize);
  const lead = isCurrent ? size.current : size.past;
  const tall = content.contentScale > 1;
  const translated = translationOn && mode !== "original" && (line.translation !== undefined || translationExpected);
  // Translation view: the translation is the line, the original under it, faint (and still the sentence that is clicked).
  const translationFirst = translated && mode === "translation";
  const originalSize = translationFirst ? Math.round(lead * 0.68) : lead;
  const translation = translated && (
    <div
      data-prompt-translation
      dir={target.dir}
      lang={targetLang}
      className={blurTranslation && !translationFirst ? "readr-prompt-text readr-blur" : "readr-prompt-text"}
      style={{ fontFamily: target.fontOver(fontFamilyMap[font]), fontSize: translationFirst ? lead : Math.round(lead * 0.68), lineHeight: translationFirst ? 1.4 : 1.5, color: translationFirst ? tokens.text : tokens.secondary, marginTop: translationFirst ? 0 : 4, fontWeight: translationFirst && isCurrent ? 500 : 400, fontStyle: translationFirst || target.contentScale > 1 ? "normal" : "italic" }}
    >
      {line.translation ?? <span style={{ opacity: 0.5 }}>…</span>}
    </div>
  );
  return (
    <div
      data-prompt-line={isCurrent ? "current" : "past"}
      className={isCurrent ? "readr-prompt-line readr-prompt-in" : "readr-prompt-line"}
      style={{ opacity: line.opacity, marginBottom: isCurrent ? 18 : 14 }}
    >
      {translationFirst && translation}
      <div
        data-sentence-key={line.key}
        data-final={line.final}
        className="readr-sentence readr-prompt-text"
        style={{ ["--sentence-hover" as string]: tokens.sentenceHover, fontSize: originalSize, lineHeight: tall ? 1.75 : 1.4, fontWeight: isCurrent && !translationFirst ? 500 : 400, letterSpacing: tall || translationFirst ? 0 : "-0.2px", textAlign: "start", opacity: translationFirst ? 0.55 : 1, marginTop: translationFirst ? 4 : 0 }}
      >
        <SentenceWords text={line.text} k={line.key} onWord={onWord} />
      </div>
      {!translationFirst && translation}
    </div>
  );
}

/** The words being heard, faint, under the current line: only this redraws as they change. */
function PromptPreview({ cues, size, lineHeight, tokens, lang }: { cues: TeleprompterCue[]; size: number; lineHeight: number; tokens: ReadingTokens; lang: string }) {
  countRender("TeleprompterPreview");
  const { t } = useTranslation();
  const partial = useLivePartial();
  const error = useLiveError();
  const preview = error ?? teleprompterLines(cues, partial, KEEP).preview;
  // Before the first words: chrome, English and left to right.
  if (!preview && cues.length === 0)
    return (
      <p data-prompt-preview data-live-waiting="" dir="ltr" style={{ fontFamily: UI_FONT, fontSize: 13, color: tokens.secondary, margin: 0 }}>
        {t("app.listening")}
      </p>
    );
  return (
    <p data-prompt-preview data-sentence-key="live-preview" data-final="false" lang={lang} className="readr-prompt-text" style={{ fontSize: size, lineHeight, opacity: preview ? 0.45 : 0, margin: 0, minHeight: `${lineHeight}em` }}>
      {preview}
    </p>
  );
}
