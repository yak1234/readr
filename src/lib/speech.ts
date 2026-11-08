// Read-aloud built on the system's speech voices (free and offline).
// Speaks sentence by sentence so the reader can highlight and follow along.

import { useCallback, useEffect, useRef, useState } from "react";

export function useVoices(lang: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang)));
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, [lang]);
  return voices;
}

export function speakOnce(text: string, lang: string, rate = 1, voiceURI = "") {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "fr" ? "fr-FR" : lang;
  u.rate = rate;
  const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI) ??
    synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  synth.speak(u);
}

interface Options {
  sentences: string[];
  lang: string;
  rate: number;
  voiceURI: string;
  onFinished: () => void;
}

export function useSentenceReader({ sentences, lang, rate, voiceURI, onFinished }: Options) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const token = useRef(0); // invalidates callbacks from cancelled utterances

  const speakFrom = useCallback(
    (i: number) => {
      const synth = window.speechSynthesis;
      if (!synth || i >= sentences.length) {
        setPlaying(false);
        if (i >= sentences.length) onFinished();
        return;
      }
      const my = ++token.current;
      synth.cancel();
      setIndex(i);
      const u = new SpeechSynthesisUtterance(sentences[i]);
      u.lang = lang === "fr" ? "fr-FR" : lang;
      u.rate = rate;
      const voice = synth.getVoices().find((v) => v.voiceURI === voiceURI) ??
        synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
      if (voice) u.voice = voice;
      u.onend = () => {
        if (token.current === my) speakFrom(i + 1);
      };
      u.onerror = () => {
        if (token.current === my) setPlaying(false);
      };
      synth.speak(u);
      setPlaying(true);
    },
    [sentences, lang, rate, voiceURI, onFinished],
  );

  const pause = useCallback(() => {
    token.current++;
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }, []);

  const play = useCallback(() => speakFrom(index), [speakFrom, index]);
  const next = useCallback(() => speakFrom(Math.min(index + 1, sentences.length - 1)), [speakFrom, index, sentences.length]);
  const prev = useCallback(() => speakFrom(Math.max(index - 1, 0)), [speakFrom, index]);

  // Restart the current sentence when speed or voice changes mid-playback.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (playingRef.current) speakFrom(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate, voiceURI]);

  useEffect(() => () => {
    token.current++;
    window.speechSynthesis?.cancel();
  }, []);

  return { index, playing, play, pause, next, prev, jumpTo: speakFrom };
}
