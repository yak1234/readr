// Plays a flashcard's sounds (src/lib/card-sounds.ts) one after another: the word, a short breath, then the
// sentence. One sound at a time across the app: playing claims the audio (the radio, TV or read-aloud stops
// and doesn't resume), and anything else that plays stops this. Speech comes from Magpie at its better
// quality and is kept for a while, so playing a card again is instant.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { audioFocus } from "./audio-focus";
import type { CardPart, CardSound } from "./card-sounds";

const BREATH_MS = 350; // between the word and the sentence
const KEPT = 40; // spoken texts kept as audio

const spoken = new Map<string, Promise<string>>();

function speechUrl(text: string, lang: string, voice: string): Promise<string> {
  const key = `${voice}\u0000${lang}\u0000${text}`;
  let url = spoken.get(key);
  if (url) {
    spoken.delete(key); // most recently used goes last
    spoken.set(key, url);
    return url;
  }
  url = api.speak(text, lang, voice, "best").then((bytes) => URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" })));
  url.catch(() => spoken.get(key) === url && spoken.delete(key)); // a voice not ready yet is asked again next time
  spoken.set(key, url);
  for (const [k, old] of spoken) {
    if (spoken.size <= KEPT) break;
    spoken.delete(k);
    old.then(URL.revokeObjectURL, () => undefined);
  }
  return url;
}

/** The audio for a sound, and what to do once it has played (a clip's URL is made for this play only). */
async function open(sound: CardSound, voice: string): Promise<{ url: string; done: () => void }> {
  if (sound.kind === "speech") return { url: await speechUrl(sound.text, sound.lang, voice), done: () => undefined };
  const url = URL.createObjectURL(new Blob([sound.bytes as BlobPart], { type: "audio/ogg" }));
  return { url, done: () => URL.revokeObjectURL(url) };
}

/** `play(parts)` plays the parts with a sound in order, replacing whatever this player was playing;
 * `playing` is the id of the part sounding now. */
export function useCardAudio(voice: string) {
  const [playing, setPlaying] = useState<string | null>(null);
  const run = useRef(0); // invalidates a sequence that was stopped or replaced
  const audio = useRef<HTMLAudioElement | null>(null);

  const halt = () => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
  };
  const stop = useCallback(() => {
    halt();
    setPlaying(null);
  }, []);

  // One "clip" key for the cards' players: only one is on screen at a time (the review screen or the cards
  // list), and its registration replaces the one before it; unregister leaves a newer one alone.
  useEffect(() => {
    const unregister = audioFocus.register("clip", stop);
    return () => {
      unregister();
      stop();
    };
  }, [stop]);

  const play = useCallback(
    async (parts: CardPart[]) => {
      halt();
      const my = run.current;
      const queue = parts.filter((p): p is CardPart & { sound: CardSound } => p.sound !== null);
      for (let i = 0; i < queue.length; i++) {
        const { id, sound } = queue[i];
        if (i > 0) await new Promise((r) => setTimeout(r, BREATH_MS));
        if (run.current !== my) return;
        setPlaying(id);
        let opened: Awaited<ReturnType<typeof open>>;
        try {
          opened = await open(sound, voice);
        } catch {
          continue; // the voice isn't ready: the other part still plays
        }
        if (run.current !== my) return opened.done();
        audioFocus.claim("clip");
        const el = new Audio(opened.url);
        audio.current = el;
        // "pause" comes both when it ends and when it is stopped.
        await new Promise<void>((resolve) => {
          el.onpause = el.onerror = () => resolve();
          el.play().catch(() => resolve());
        });
        el.onpause = el.onerror = null;
        opened.done();
        if (run.current !== my) return;
      }
      audio.current = null;
      setPlaying(null);
    },
    [voice],
  );

  return { play, stop, playing };
}
