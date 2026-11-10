// Read-aloud with NVIDIA Magpie TTS (local, via the voice server). Speaks
// sentence by sentence so the reader can highlight and follow along; the next
// sentences are synthesised while the current one plays.

import { useCallback, useEffect, useRef, useState } from "react";
import { cleanIpcError } from "../../shared/errors";
import { api } from "./api";
import { audioFocus } from "./audio-focus";
import { i18n } from "../i18n";

export interface VoiceState {
  voices: string[];
  ready: boolean;
  message: string;
}

/** Magpie's speakers, polled until the voice server is ready. */
export function useVoices(): VoiceState {
  const [state, setState] = useState<VoiceState>({ voices: [], ready: false, message: i18n.t("player.startingVoice") });
  useEffect(() => {
    let timer: number;
    let alive = true;
    const tick = async () => {
      const s = await api.ttsStatus().catch(() => null);
      if (!alive) return;
      if (s) setState(s);
      timer = window.setTimeout(tick, s?.ready ? 60_000 : 3_000);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);
  return state;
}

async function clipUrl(text: string, lang: string, voice: string, quality: "fast" | "best"): Promise<string> {
  const bytes = await api.speak(text, lang, voice, quality);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
}

let onceAudio: HTMLAudioElement | null = null;
audioFocus.register("word", () => onceAudio?.pause()); // anything else that plays cuts the word short

/** Say a word or short phrase (dictionary, cards). Uses the higher-quality setting. Like any player, it
 * claims the audio first: the radio, read-aloud or a card's clip stops (and doesn't resume). */
export async function speakOnce(text: string, lang: string, rate = 1, voice = "") {
  try {
    const url = await clipUrl(text, lang, voice, "best");
    audioFocus.claim("word");
    onceAudio?.pause();
    onceAudio = new Audio(url);
    onceAudio.playbackRate = rate;
    onceAudio.onended = () => URL.revokeObjectURL(url);
    await onceAudio.play();
  } catch {
    /* voice not ready: the button simply does nothing yet */
  }
}

interface Options {
  sentences: string[];
  lang: string;
  rate: number;
  voice: string;
  onFinished: () => void;
}

const AHEAD = 2; // sentences synthesised ahead of the one playing
/** Errors that mean "not ready yet" rather than "failed". */
const VOICE_LOADING = /loading|starting|not running|fetch failed|ECONNREFUSED|503/i;

export function useSentenceReader({ sentences, lang, rate, voice, onFinished }: Options) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false); // playing, but the audio isn't ready yet
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const clips = useRef(new Map<number, Promise<string>>());
  const token = useRef(0); // invalidates callbacks from stopped playback
  const rateRef = useRef(rate);
  rateRef.current = rate;

  // A new text or voice means new audio. A new text also stops reading.
  const textRef = useRef(sentences);
  useEffect(() => {
    const old = clips.current;
    clips.current = new Map();
    old.forEach((p) => p.then(URL.revokeObjectURL, () => undefined));
    if (textRef.current !== sentences) {
      textRef.current = sentences;
      token.current++;
      stopAudio();
      setIndex(0);
      setPlaying(false);
      setWaiting(false);
      setError(null);
    }
  }, [sentences, lang, voice]);

  const clip = useCallback(
    (i: number) => {
      const map = clips.current;
      let p = map.get(i);
      if (!p) {
        const created = clipUrl(sentences[i], lang, voice, "fast");
        created.catch(() => map.get(i) === created && map.delete(i)); // let a retry ask again
        map.set(i, created);
        p = created;
      }
      return p;
    },
    [sentences, lang, voice],
  );

  const stopAudio = () => {
    audio.current?.pause();
    audio.current = null;
  };

  const speakFrom = useCallback(
    async (i: number) => {
      const my = ++token.current;
      stopAudio();
      if (i >= sentences.length) {
        setPlaying(false);
        setWaiting(false);
        onFinished();
        return;
      }
      setIndex(i);
      setPlaying(true);
      setError(null);
      setWaiting(true);
      // Ask for the next ones in order; the server makes them one at a time.
      let url = "";
      // While the voice is still loading, keep waiting and retry (about 5 min).
      for (let attempt = 0; ; attempt++) {
        const current = clip(i);
        for (let k = 1; k <= AHEAD && i + k < sentences.length; k++) {
          current.then(() => void (token.current === my && clip(i + k))).catch(() => undefined);
        }
        try {
          url = await current;
          break;
        } catch (e) {
          if (token.current !== my) return;
          const message = cleanIpcError(e);
          if (VOICE_LOADING.test(message) && attempt < 100) {
            await new Promise((r) => setTimeout(r, 3000));
            if (token.current !== my) return;
            continue;
          }
          setPlaying(false);
          setWaiting(false);
          setError(message);
          return;
        }
      }
      if (token.current !== my) return;
      setWaiting(false);
      const a = new Audio(url);
      a.playbackRate = rateRef.current;
      a.onended = () => {
        if (token.current === my) speakFrom(i + 1);
      };
      audio.current = a;
      a.play().catch(() => token.current === my && setPlaying(false));
    },
    [sentences, clip, onFinished],
  );

  const pause = useCallback(() => {
    token.current++;
    stopAudio();
    setPlaying(false);
    setWaiting(false);
  }, []);

  const play = useCallback(() => speakFrom(index), [speakFrom, index]);
  const next = useCallback(() => speakFrom(Math.min(index + 1, sentences.length - 1)), [speakFrom, index, sentences.length]);
  const prev = useCallback(() => speakFrom(Math.max(index - 1, 0)), [speakFrom, index]);

  // Speed changes apply immediately, without re-synthesising.
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate]);

  // A different voice restarts the current sentence in that voice.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (playingRef.current) speakFrom(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);

  useEffect(
    () => () => {
      token.current++;
      stopAudio();
    },
    [],
  );

  return { index, playing, waiting, error, play, pause, next, prev, jumpTo: speakFrom };
}
