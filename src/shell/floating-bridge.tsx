// The floating player's link to this window: it shows whatever is playing, and its commands land here.
// "Open" (clicking its title) goes to what plays through the router, like any other navigation.

import { useCallback } from "react";
import { useFloatingBridge } from "../lib/floating-sync";
import { useSavedSurfaces } from "../lib/cards-hooks";
import { useRadioState } from "../lib/radio-session";
import { stationTarget } from "../lib/settings";
import type { FloatingCommand } from "../../shared/types";
import { useOpen } from "./open-actions";
import { useReader } from "./reader-provider";
import { useReading } from "./reading-provider";
import { useReadrSettings } from "./settings-provider";

export function FloatingBridge() {
  const { settings, update } = useReadrSettings();
  const reader = useReader();
  const reading = useReading();
  const radio = useRadioState();
  const { goToReading, showTranscript } = useOpen();
  const readerActive = reader.listening && Boolean(reader.article);
  // The words it marks as saved, in the language of what it plays (not the sidebar's).
  const savedForms = useSavedSurfaces((readerActive ? reader.article?.language : radio.article?.language) ?? "");
  // The page's own translations, when the page shows what is playing.
  const showsPlaying = readerActive ? !reading.isRadio && reading.article?.id === reader.article?.id : reading.isLive;

  const onCommand = useCallback(
    (cmd: FloatingCommand) => {
      const back = () => (readerActive ? goToReading() : showTranscript());
      if (cmd.type === "toggle-translation") update("viewMode", settings.viewMode === "original" ? "interlinear" : "original");
      else if (cmd.type === "toggle-play") {
        if (reader.playing) reader.pause();
        else if (reader.article) reader.readFrom(reader.article);
      } else if (cmd.type === "prev") reader.prev();
      else if (cmd.type === "next") reader.next();
      else if (cmd.type === "open") back();
      else if (cmd.type === "more") {
        back();
        const over = readerActive ? reader.article?.id : radio.article?.id;
        reading.setPopup({ word: cmd.word, sentence: cmd.sentence, rect: new DOMRect(Math.max(12, window.innerWidth / 2 - 160), 120, 0, 0) }, over);
      }
    },
    [readerActive, goToReading, showTranscript, update, settings.viewMode, reader, reading, radio.article],
  );

  useFloatingBridge({
    radioTarget: radio.article ? stationTarget(settings, radio.article.url) : settings.targetLang,
    articleTarget: settings.targetLang,
    translationOn: settings.viewMode !== "original",
    shownTranslations: showsPlaying ? reading.translations : null,
    shownTranslateError: Boolean(reading.translateError),
    reader: {
      active: readerActive,
      article: reader.article ? { id: reader.article.id, title: reader.article.title, source: reader.article.source, language: reader.article.language, url: reader.article.url } : null,
      playing: reader.playing,
      index: reader.index,
      keys: reader.keys,
      sentences: reader.sentences,
    },
    savedForms,
    dark: settings.readingStyle === "dark",
    onCommand,
  });
  return null;
}
