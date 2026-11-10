import { PictureInPicture2, Pause, Play, Radio, Tv, X } from "lucide-react";
import { api } from "../lib/api";
import { useTranslation } from "react-i18next";
import { languageScope } from "../lib/language-scope";
import { liveCaption } from "../../shared/live-transcript";
import { useLiveError, useLivePartial } from "../lib/live";
import { pauseRadio, playRadio, stopRadio } from "../lib/radio-player";
import { countRender } from "../lib/store";
import { useRadioState } from "../lib/radio-session";
import type { ChromeTokens } from "../lib/theme";
import { UI_FONT } from "../lib/theme";

interface Props {
  c: ChromeTokens;
  /** The radio transcript is what the reader shows right now. */
  transcriptOpen: boolean;
  onOpenTranscript: () => void;
}

/** The persistent radio (or TV) player: stays at the bottom while you read anything else.
 * Besides the transcript's preview paragraph it is the only part of the app that
 * follows the words being heard, so those updates redraw it and nothing above.
 * On the transcript it shows only the station and controls. */
export function RadioBar({ c, transcriptOpen, onOpenTranscript }: Props) {
  countRender("RadioBar");
  const { t } = useTranslation();
  const { article, playing, failed } = useRadioState();
  if (!article) return null;
  const tv = article.kind === "tv";
  const status = t(failed ? (tv ? "radio.channelUnavailable" : "radio.streamFailed") : playing ? "radio.live" : "radio.paused");
  return (
    <div data-radio-bar style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 20px", background: c.panel, borderTop: `1px solid ${c.border}`, flexShrink: 0, fontFamily: UI_FONT }}>
      <button
        data-radio-toggle
        title={t(playing ? "player.pause" : "player.play")}
        onClick={playing ? pauseRadio : playRadio}
        style={{ width: 34, height: 34, borderRadius: 17, border: "none", background: c.text, color: c.panel, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 2 }} />}
      </button>
      {tv ? <Tv size={15} color={c.muted} style={{ flexShrink: 0 }} /> : <Radio size={15} color={c.muted} style={{ flexShrink: 0 }} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 190, flexShrink: 0, minWidth: 0 }}>
        <button data-radio-title title={t(tv ? "radio.backToChannel" : "radio.openTranscriptTitle")} onClick={onOpenTranscript} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: c.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", unicodeBidi: "plaintext", textAlign: "left" }}>{article.title}</button>
        <div data-radio-status style={{ fontSize: 11, color: c.muted }}>{status}</div>
      </div>
      {!transcriptOpen ? <Partial dir={languageScope(article.language).dir} lang={article.language} color={c.body} /> : <div style={{ flex: 1 }} />}
      {!transcriptOpen && (
        <button data-open-transcript onClick={onOpenTranscript} style={{ padding: "5px 11px", borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.text, fontSize: 11, cursor: "pointer", fontFamily: UI_FONT, flexShrink: 0 }}>
          {t(tv ? "radio.backToChannel" : "radio.openTranscript")}
        </button>
      )}
      <button data-radio-popout title={t("player.popOut")} onClick={() => void api.floatingOpen()} style={{ background: "none", border: "none", cursor: "pointer", color: c.muted, padding: 6, display: "flex", flexShrink: 0 }}>
        <PictureInPicture2 size={15} />
      </button>
      <button data-radio-stop title={t(tv ? "radio.stopChannel" : "radio.stopRadio")} onClick={stopRadio} style={{ background: "none", border: "none", cursor: "pointer", color: c.muted, padding: 6, display: "flex", flexShrink: 0 }}>
        <X size={15} />
      </button>
    </div>
  );
}

/** The words being heard right now. */
function Partial({ dir, lang, color }: { dir: "ltr" | "rtl"; lang: string; color: string }) {
  const partial = useLivePartial();
  const error = useLiveError();
  return (
    <div data-bar-partial dir={dir} lang={lang} style={{ flex: 1, minWidth: 0, fontSize: 12, color, fontStyle: "normal", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {error ?? liveCaption(partial, 60)}
    </div>
  );
}
