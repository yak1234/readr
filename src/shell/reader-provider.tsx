// The read-aloud session: the article it reads (the one last opened, or the one Listen was pressed on), whether
// it is listening, and where it is. It outlives every page, so going elsewhere never stops it; opening another
// article does (as it always has), and so does anything else that starts playing (audio focus).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Article } from "../../shared/types";
import { DEFAULT_LANG } from "../../shared/languages";
import { audioFocus } from "../lib/audio-focus";
import { onRadioStart, radioStore } from "../lib/radio-session";
import { flattenArticle } from "../lib/reading";
import { useSentenceReader } from "../lib/speech";
import { useReadrSettings } from "./settings-provider";

export interface ReaderValue {
  /** The article read aloud (null before any is opened), and its sentences with their reader keys. */
  article: Article | null;
  sentences: string[];
  keys: string[];
  /** Read-aloud is on (the bar shows), and whether a sentence is sounding now. */
  listening: boolean;
  playing: boolean;
  waiting: boolean;
  error: string | null;
  index: number;
  /** The sentence being read, as a reader key, while listening. */
  activeKey: string | null;
  /** An article was opened: the session follows it, and reading stops. */
  load: (article: Article) => void;
  /** The article was deleted: reading stops and the session forgets it. */
  unload: (articleId: string) => void;
  /** Reads `article` aloud from the sentence at `key` (from where it is when no key is given). */
  readFrom: (article: Article, key?: string) => void;
  /** Listen / Stop on `article`. */
  toggle: (article: Article) => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
}

const ReaderContext = createContext<ReaderValue | null>(null);

/** What the read-aloud session follows, without where it is: it changes when another article is opened or
 * read-aloud starts or stops, not with every sentence read. */
export type ReaderSession = Pick<ReaderValue, "article" | "listening" | "load">;
const ReaderSessionContext = createContext<ReaderSession | null>(null);

export function ReaderProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useReadrSettings();
  const [article, setArticle] = useState<Article | null>(null);
  const [listening, setListening] = useState(false);
  const flat = useMemo(() => flattenArticle(article), [article]);
  const reader = useSentenceReader({
    sentences: flat.sentences,
    lang: article?.language ?? DEFAULT_LANG,
    rate: settings.speechRate,
    voice: settings.voiceURI,
    onFinished: useCallback(() => undefined, []),
  });

  // Reading another article starts once its sentences are the reader's (the reader resets on new text first).
  const [pending, setPending] = useState<{ article: Article; key?: string } | null>(null);
  useEffect(() => {
    if (!pending || pending.article !== article) return;
    setPending(null);
    audioFocus.claim("reader");
    setListening(true);
    reader.jumpTo(pending.key ? Math.max(0, flat.keys.indexOf(pending.key)) : 0);
  }, [pending, article, flat, reader]);

  const load = useCallback((a: Article) => {
    setArticle(a);
    setListening(false);
  }, []);
  const unload = useCallback(
    (id: string) => {
      if (article?.id !== id) return;
      reader.pause();
      setListening(false);
      setArticle(null);
    },
    [article, reader],
  );
  const readFrom = useCallback(
    (a: Article, key?: string) => {
      if (a.live) return; // a transcript isn't read aloud
      if (article?.id !== a.id) {
        setArticle(a);
        setPending({ article: a, key });
        return;
      }
      audioFocus.claim("reader");
      setListening(true);
      if (key) reader.jumpTo(Math.max(0, flat.keys.indexOf(key)));
      else reader.play();
    },
    [article, flat, reader],
  );
  const toggle = useCallback(
    (a: Article) => {
      if (listening && article?.id === a.id) {
        reader.pause();
        setListening(false);
      } else readFrom(a);
    },
    [listening, article, reader, readFrom],
  );
  // One sound at a time: each of these claims the audio (the station and a card's clip pause).
  const claimed = useCallback((f: () => void) => () => {
    audioFocus.claim("reader");
    f();
  }, []);

  // Anything else that plays ends read-aloud; it doesn't resume afterwards.
  const stop = useRef(reader.pause);
  stop.current = reader.pause;
  const listeningRef = useRef(listening);
  listeningRef.current = listening;
  useEffect(
    () =>
      audioFocus.register("reader", () => {
        stop.current();
        setListening(false);
      }),
    [],
  );
  // Immediately, whichever path starts a station (before its stream even connects).
  useEffect(
    () =>
      onRadioStart(() => {
        if (!listeningRef.current) return;
        stop.current();
        setListening(false);
      }),
    [],
  );
  // Backstop: a station that starts playing ends any read-aloud (pausing it to read must not).
  const radioPlaying = useSyncExternalStore(radioStore.subscribe, () => radioStore.get().playing);
  useEffect(() => {
    if (radioPlaying && listeningRef.current) {
      stop.current();
      setListening(false);
    }
  }, [radioPlaying]);

  const value = useMemo<ReaderValue>(
    () => ({
      article,
      sentences: flat.sentences,
      keys: flat.keys,
      listening,
      playing: reader.playing,
      waiting: reader.waiting,
      error: reader.error,
      index: reader.index,
      activeKey: listening ? flat.keys[reader.index] ?? null : null,
      load,
      unload,
      readFrom,
      toggle,
      play: claimed(reader.play),
      pause: reader.pause,
      next: claimed(reader.next),
      prev: claimed(reader.prev),
    }),
    [article, flat, listening, reader, load, unload, readFrom, toggle, claimed],
  );
  const session = useMemo<ReaderSession>(() => ({ article, listening, load }), [article, listening, load]);
  return (
    <ReaderSessionContext.Provider value={session}>
      <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>
    </ReaderSessionContext.Provider>
  );
}

/** The read-aloud session's article and whether it is on, for what doesn't follow the sentence being read. */
export function useReaderSession(): ReaderSession {
  const value = useContext(ReaderSessionContext);
  if (!value) throw new Error("useReaderSession outside ReaderProvider");
  return value;
}

export function useReader(): ReaderValue {
  const value = useContext(ReaderContext);
  if (!value) throw new Error("useReader outside ReaderProvider");
  return value;
}
