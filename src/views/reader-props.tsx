// What every page that shows a text in the reader shares: the reader's settings and translations for the
// article shown, and the note that says why translations are missing.

import React from "react";
import type { Article } from "../../shared/types";
import type { ReaderView } from "../components/reader-view";
import { useReader } from "../shell/reader-provider";
import { useReading } from "../shell/reading-provider";
import { useReadrSettings } from "../shell/settings-provider";

type ReaderProps = Omit<React.ComponentProps<typeof ReaderView>, "activeKey">;

/** The ReaderView props for `article`: clicking a word opens the popup, a sentence's play button reads from it. */
export function useReaderProps(article: Article): ReaderProps {
  const { settings, tokens } = useReadrSettings();
  const { tgt, noTranslation, translations, setPopup } = useReading();
  const reader = useReader();
  return {
    article,
    mode: settings.viewMode,
    targetLang: tgt,
    translationExpected: !noTranslation,
    translations,
    blurTranslation: settings.blurTranslation,
    fontSize: settings.fontSize,
    font: settings.font,
    tokens,
    focusMode: settings.focusMode,
    onWord: setPopup,
    onReadFrom: (key: string) => reader.readFrom(article, key),
  };
}

/** No translation for this language pair, or the translator failed: said once above the text. */
export function TranslationNote() {
  const { settings, tokens } = useReadrSettings();
  const { noTranslation, planNote, translateError } = useReading();
  const note = noTranslation ? planNote : translateError;
  if (!note || settings.viewMode === "original") return null;
  return <div style={{ maxWidth: 700, margin: "16px auto 0", padding: "8px 14px", borderRadius: 6, fontSize: 12, background: tokens.sentenceHover, color: tokens.secondary }}>{note}</div>;
}
