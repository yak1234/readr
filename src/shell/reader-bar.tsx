// The read-aloud bar, on every page while listening: what is being read, where, the voice and speed, and the
// way back to it.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "../components/audio-player";
import { api } from "../lib/api";
import { useVoices } from "../lib/speech";
import { useOpen } from "./open-actions";
import { useReader } from "./reader-provider";
import { useReadrSettings } from "./settings-provider";

export function ReaderBar({ left, right, bottom }: { left: number; right: number; bottom: number }) {
  const { t } = useTranslation();
  const { settings, update } = useReadrSettings();
  const reader = useReader();
  const voices = useVoices();
  const { goToReading } = useOpen();
  const { article, sentences, index } = reader;
  const remainingSeconds = useMemo(() => (sentences.slice(index).join(" ").split(/\s+/).length / (160 * settings.speechRate)) * 60, [sentences, index, settings.speechRate]);
  if (!reader.listening || !article) return null;
  return (
    <AudioPlayer
      style={settings.readingStyle}
      source={article.source}
      title={article.title}
      playing={reader.playing}
      index={index}
      total={sentences.length}
      remainingSeconds={remainingSeconds}
      rate={settings.speechRate}
      onRate={(r) => update("speechRate", r)}
      voices={voices.voices}
      voicesReady={voices.ready}
      status={reader.error ?? (reader.waiting ? (voices.ready ? t("app.preparingVoice") : voices.message) : null)}
      voice={settings.voiceURI}
      onVoice={(v) => update("voiceURI", v)}
      onPlay={() => reader.readFrom(article)}
      onPause={reader.pause}
      onPrev={reader.prev}
      onNext={reader.next}
      onOpenArticle={goToReading}
      onPopOut={() => void api.floatingOpen()}
      left={left}
      right={right}
      bottom={bottom}
    />
  );
}
