// Live TV in a wide window: the picture on the left (62% of the width, the largest 16:9 that fits the
// full height, centred) and the teleprompter on the right. "Transcript" swaps the teleprompter for the
// whole scrolling transcript, with Earlier. Below TELEPROMPTER_FROM the page is stacked instead (TvStage).

import { useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { countRender } from "../lib/store";
import { UI_FONT, type ReadingTokens } from "../lib/theme";
import { LagNote } from "./tv-stage";

interface Props {
  tokens: ReadingTokens;
  /** The picture (TvPicture fitted to contain). */
  picture: React.ReactNode;
  /** Said above the captions (why translations are missing), if anything. */
  note?: React.ReactNode;
  teleprompter: React.ReactNode;
  /** The whole transcript, scrolling in `scrollEl`. */
  transcript: (scrollEl: React.RefObject<HTMLElement | null>) => React.ReactNode;
}

export function TvSideBySide({ tokens, picture, note, teleprompter, transcript }: Props) {
  countRender("TvSideBySide");
  const { t } = useTranslation();
  const [whole, setWhole] = useState(false);
  const scrollEl = useRef<HTMLDivElement>(null);
  return (
    <div data-tv-side style={{ display: "grid", gridTemplateColumns: "62% minmax(0, 1fr)", height: "100%", minHeight: 0 }}>
      <div data-tv-picture-pane style={{ padding: 24, minWidth: 0, minHeight: 0 }}>
        {/* A size container: the picture is the largest 16:9 box inside it. */}
        <div style={{ containerType: "size", height: "100%", display: "grid", placeItems: "center" }}>{picture}</div>
      </div>

      <section data-tv-captions style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, borderLeft: `1px solid ${tokens.border}` }}>
        {/* Chrome: English, left to right. */}
        <div dir="ltr" style={{ display: "flex", justifyContent: "flex-end", padding: "14px 20px 0", fontFamily: UI_FONT }}>
          <button
            data-tv-transcript
            aria-pressed={whole}
            title={t(whole ? "tv.showTeleprompter" : "tv.showTranscript")}
            onClick={() => setWhole(!whole)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontFamily: UI_FONT, padding: "4px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${tokens.border}`, background: whole ? tokens.sentenceHover : "transparent", color: whole ? tokens.text : tokens.secondary, transition: "background 0.2s ease, color 0.2s ease" }}
          >
            <ScrollText size={13} />
            {t("tv.transcript")}
          </button>
        </div>
        {note}
        {whole ? (
          <div ref={scrollEl} data-tv-transcript-scroll style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {transcript(scrollEl)}
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 32px 16px" }}>
            {teleprompter}
            <LagNote tokens={tokens} />
          </div>
        )}
      </section>
    </div>
  );
}
