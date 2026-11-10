// /live/:kind/:id — the selected station's or channel's live transcript (with the video for TV). Coming Back to
// a station that is no longer selected says so and offers to play it: navigating never starts or stops audio.

import { useMemo, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Article } from "../../shared/types";
import { EarlierToggle } from "../components/earlier-list";
import { RadioReader } from "../components/live-reader";
import { Notice, NoticeButton } from "../components/notice";
import { Teleprompter } from "../components/teleprompter";
import { TvSideBySide } from "../components/tv-side-by-side";
import { TvPicture, TvStage } from "../components/tv-stage";
import { useElementWidth } from "../lib/element-width";
import { useFullscreenElement, useHeld } from "../lib/fullscreen";
import { TELEPROMPTER_FROM } from "../lib/teleprompter";
import { useRadioState } from "../lib/radio-session";
import { flattenArticle } from "../lib/reading";
import { useLibrary } from "../shell/library-provider";
import { useOpen } from "../shell/open-actions";
import { useReading } from "../shell/reading-provider";
import { useMain, useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import { TranslationNote, useReaderProps } from "./reader-props";

export function LivePage() {
  const { article, page } = useReading();
  // The transcript follows the sentence being heard: arriving leaves the scroll to it.
  useScrollRestore(Boolean(article), () => undefined);
  if (!article) return <NotPlaying id={page?.page === "live" ? page.id : ""} />;
  return <LiveTranscript article={article} />;
}

function LiveTranscript({ article }: { article: Article }) {
  const { settings, update, c } = useReadrSettings();
  const { isTv, translations, noTranslation, translateError } = useReading();
  const radio = useRadioState();
  const { openSession } = useOpen();
  const main = useMain();
  const flat = useMemo(() => flattenArticle(article), [article]);
  const flatCues = useMemo(() => (article.cues ?? []).flat().map(([start, end]) => ({ text: "", start, end })), [article]);
  const props = useReaderProps(article);
  // Earlier sessions of this station, from its own view (the settings panel may be closed).
  const earlier = <EarlierToggle c={c} stationIds={[article.id, article.url].filter(Boolean)} onOpen={(s) => openSession(s.id, { url: article.url })} />;
  // With room (the main column, between the side panels) a channel's picture and its teleprompter sit side by
  // side; with less they are stacked. Full screen grows the window: the layout holds meanwhile, or the picture
  // in full screen would be swapped for the other layout's, which ends full screen.
  const roomy = useElementWidth(main) >= TELEPROMPTER_FROM;
  const sideBySide = useHeld(roomy, useFullscreenElement() !== null) && isTv;
  const translationExpected = !noTranslation && !translateError;
  const picture = {
    article,
    failed: radio.failed && radio.article?.url === article.url,
    translations,
    translationOn: settings.viewMode !== "original" && !noTranslation,
    translationExpected,
  };
  const transcript = (scrollEl: RefObject<HTMLElement | null>, headerActions?: ReactNode) => (
    <RadioReader
      {...props}
      headerActions={headerActions}
      lastFinal={article.blocks.at(-1)?.sentences.at(-1)}
      translationExpected={translationExpected}
      flatCues={flatCues}
      keys={flat.keys}
      scrollEl={scrollEl}
      virtualize={settings.liveWindowMinutes === 0}
    />
  );
  if (sideBySide)
    return (
      <TvSideBySide
        tokens={props.tokens}
        picture={<TvPicture {...picture} subtitles={settings.tvSideSubtitles} onSubtitles={(on) => update("tvSideSubtitles", on)} fit="contain" subtitlesInFullscreen />}
        note={<div style={{ padding: "0 20px" }}><TranslationNote /></div>}
        teleprompter={<Teleprompter article={article} translations={translations} translationOn={picture.translationOn} translationExpected={translationExpected} targetLang={props.targetLang} mode={props.mode} blurTranslation={props.blurTranslation} fontSize={props.fontSize} font={props.font} tokens={props.tokens} onWord={props.onWord} />}
        transcript={(scrollEl) => transcript(scrollEl, earlier)}
      />
    );
  return (
    <>
      <TranslationNote />
      {isTv && <TvStage tokens={props.tokens} {...picture} subtitles={settings.tvSubtitles} onSubtitles={(on) => update("tvSubtitles", on)} earlier={earlier} />}
      {transcript(main, isTv ? undefined : earlier)}
    </>
  );
}

/** A station or channel that isn't the one selected any more. */
function NotPlaying({ id }: { id: string }) {
  const { t } = useTranslation();
  const { tokens } = useReadrSettings();
  const { stations, channels, tryingStation, tryingChannel } = useLibrary();
  const { openUrl } = useOpen();
  const known = [...stations, ...channels, tryingStation, tryingChannel].find((x) => x?.id === id);
  return (
    <Notice tokens={tokens} title={t("app.notPlaying")} body={t("app.notPlayingBody")}>
      {known && <NoticeButton tokens={tokens} primary onClick={() => openUrl(known.url, { replace: true })}>{t("app.playAgain")}</NoticeButton>}
    </Notice>
  );
}
