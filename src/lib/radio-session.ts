// The live session (a radio station or a TV channel): which one is selected, whether it plays, and the
// transcript written so far. It lives outside the reader, so opening an article
// doesn't touch it. The audio itself is driven by radio-player.ts.

import type { Article } from "../../shared/types";
import type { Cue } from "../../shared/captions";
import { DEFAULT_WINDOW, appendCues, trimLive, type WindowOptions } from "../../shared/live-transcript";
import { useSyncExternalStore } from "react";
import { createStore, type Store } from "./store";
import { audioFocus } from "./audio-focus";

export interface RadioState {
  /** The station's live transcript (null when no station is selected). */
  article: Article | null;
  playing: boolean;
  /** The stream couldn't be played. */
  failed: boolean;
}

const IDLE: RadioState = { article: null, playing: false, failed: false };

export function createRadioStore() {
  const store: Store<RadioState> = createStore(IDLE);
  const patch = (p: Partial<RadioState>) => store.set({ ...store.get(), ...p });
  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Selects a station. False (and nothing changes) when it is already the one
     * selected in that language: the transcript carries on. */
    select(article: Article): boolean {
      const cur = store.get().article;
      if (cur && cur.url === article.url && cur.language === article.language) return false;
      store.set({ article, playing: false, failed: false });
      return true;
    },
    setPlaying(playing: boolean) {
      if (store.get().playing !== playing || store.get().failed) patch({ playing, failed: false });
    },
    setFailed() {
      patch({ playing: false, failed: true });
    },
    addCues(cues: Cue[], opts: WindowOptions) {
      const cur = store.get().article;
      if (cur) patch({ article: appendCues(cur, cues, opts) });
    },
    trim(opts: WindowOptions) {
      const cur = store.get().article;
      if (!cur) return;
      const next = trimLive(cur, opts);
      if (next !== cur) patch({ article: next });
    },
    stop() {
      store.set(IDLE);
    },
  };
}

export const radioStore = createRadioStore();

/** Called the moment any live start path begins (selecting a station or TV channel,
 * pressing play), before the stream connects: read-aloud ends there, so they never
 * overlap. Radio and TV share this one session, so starting either stops the other. */
const startListeners = new Set<() => void>();
export function onRadioStart(cb: () => void): () => void {
  startListeners.add(cb);
  return () => void startListeners.delete(cb);
}
export function announceRadioStart() {
  audioFocus.claim("radio"); // a flashcard's clip stops too
  startListeners.forEach((cb) => cb());
}

/** Playback position in seconds, for highlighting the sentence being heard. */
export const radioTime = createStore(0);

/** What the transcript keeps; set from the settings and the sentences cards were made from. */
export const radioWindow: WindowOptions = { ...DEFAULT_WINDOW };

export function setRadioWindow(minutes: number, keep?: (sentence: string) => boolean) {
  radioWindow.windowSeconds = minutes * 60;
  radioWindow.keep = keep;
  radioStore.trim(radioWindow);
}

/** The session as components see it. Controls come from radio-player.ts. */
export function useRadioState(): RadioState {
  return useSyncExternalStore(radioStore.subscribe, radioStore.get);
}
