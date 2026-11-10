// A live transcript (radio or TV) in the reader: it follows the sentence being heard from the player's clock,
// and ends with the words being heard now. Both subscribe to their own stores, so the many updates a second
// redraw these and nothing above them.

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cueAt } from "../../shared/captions";
import { previewParagraph } from "../../shared/live-transcript";
import { Fresh } from "../lib/fresh";
import { languageScope } from "../lib/language-scope";
import { useLiveError, useLivePartial } from "../lib/live";
import { radioTime } from "../lib/radio-session";
import { countRender, useStore } from "../lib/store";
import { fontFamilyMap, ReadingFont, ReadingTokens, UI_FONT } from "../lib/theme";
import { ReaderView } from "./reader-view";

/** A radio transcript: highlights the sentence being heard. The player's clock
 * ticks several times a second, so this follows it itself and App never sees it. */
export function RadioReader({ flatCues, keys, lastFinal, ...props }: Omit<React.ComponentProps<typeof ReaderView>, "activeKey" | "tail" | "freshSentences" | "freshTranslations"> & { flatCues: { start: number; end: number; text: string }[]; keys: string[]; lastFinal?: string }) {
  const activeKey = useStore(radioTime, (t) => {
    const i = cueAt(flatCues, t);
    return i >= 0 ? keys[i] ?? null : null;
  });
  useEffect(() => {
    if (activeKey) document.querySelector(`[data-key="${activeKey}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeKey]);
  // Only what arrives while this transcript is open fades in.
  const [freshSentences] = useState(() => new Fresh());
  const [freshTranslations] = useState(() => new Fresh());
  freshSentences.observe(props.article.blocks.flatMap((b) => b.sentences));
  freshTranslations.observe(Object.keys(props.translations));
  const tail = <LivePreview font={props.font} tokens={props.tokens} body={Math.round(19 * (props.fontSize / 100))} lang={props.article.language} empty={props.article.blocks.length === 0} lastFinal={lastFinal} />;
  return <ReaderView {...props} activeKey={activeKey} tail={tail} freshSentences={freshSentences} freshTranslations={freshTranslations} />;
}

/** The words being heard, as the transcript's last paragraph: same type as the
 * finished sentences, faded until they are final. It subscribes to the live text
 * itself, so only this paragraph redraws as the words change. */
function LivePreview({ font, tokens, body, lang, empty, lastFinal }: { font: ReadingFont; tokens: ReadingTokens; body: number; lang: string; empty: boolean; lastFinal?: string }) {
  countRender("LivePreview");
  const { t } = useTranslation();
  const partial = useLivePartial();
  const error = useLiveError();
  const content = languageScope(lang);
  const text = error ?? previewParagraph(partial, lastFinal);
  if (!text && !empty) return null;
  // Waiting for the first words is chrome: English, left to right. The words are the station's language.
  if (!text)
    return (
      <p data-live-preview data-live-waiting="" data-sentence-key="live-preview" data-final="false" dir="ltr" style={{ fontFamily: UI_FONT, fontSize: Math.round(body * 0.8), lineHeight: 1.75, color: tokens.secondary, margin: "0 0 24px" }}>
        {t("app.listening")}
      </p>
    );
  return (
    <p data-live-preview data-sentence-key="live-preview" data-final="false" dir={content.dir} lang={lang} style={{ fontFamily: content.fontOver(fontFamilyMap[font]), fontSize: body, lineHeight: 1.75, fontStyle: "normal", color: tokens.text, opacity: 0.5, margin: "0 0 24px" }}>
      {text}
    </p>
  );
}
