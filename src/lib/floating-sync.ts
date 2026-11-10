// Main window side of the floating player: pushes it what to show, which is
// whatever is playing (a radio station, a TV channel's follow-along text, or the
// article being read aloud). The
// words being heard come straight from the live-text store (not through React),
// so they don't redraw the app; everything else is pushed when it changes.

import { useEffect, useRef, useState } from "react";
import type { FloatingCommand, FloatingState } from "../../shared/types";
import { DEFAULT_LANG, languageInfo } from "../../shared/languages";
import { nowPlaying, playingFields, savedWords, type NowPlayingReader } from "../../shared/floating";
import { api } from "./api";
import { liveText } from "./live";
import { radioStore } from "./radio-session";
import { playRadio, pauseRadio } from "./radio-player";

export interface FloatingInput {
  /** Language a station is translated into / language articles are. */
  radioTarget: string;
  articleTarget: string;
  translationOn: boolean;
  /** The main window's own translations when what it shows is what is playing. */
  shownTranslations: Record<string, string> | null;
  /** That translation request failed. */
  shownTranslateError: boolean;
  /** The read-aloud session. */
  reader: NowPlayingReader;
  /** The forms of the cards made (saved words are marked). */
  savedForms: string[];
  dark: boolean;
  onCommand: (cmd: FloatingCommand) => void;
}

const EMPTY: FloatingState = { kind: null, id: "", title: "", source: "", language: DEFAULT_LANG, url: "", target: "en", playing: false, failed: false, sentences: [], partial: "", error: null, translations: {}, translationOn: true, translationExpected: false, savedWords: [], dark: false };

/** A radio station or TV channel: a live transcript (rather than read-aloud). */
const isLive = (kind: string | null | undefined) => kind === "radio" || kind === "tv";

/** Which of the floating window's sentences still need a translation. */
export function missingTranslations(sentences: { text: string }[], have: Record<string, string>): string[] {
  return [...new Set(sentences.map((s) => s.text).filter((t) => have[t] === undefined))];
}

export function useFloatingBridge(input: FloatingInput) {
  const state = useRef<FloatingState>(EMPTY);
  const inputRef = useRef(input);
  inputRef.current = input;
  const [own, setOwn] = useState<{ key: string; map: Record<string, string>; failed: boolean }>({ key: "", map: {}, failed: false });

  const push = (patch: Partial<FloatingState>) => {
    state.current = { ...state.current, ...patch };
    api.floatingPush(state.current);
  };
  const current = () => {
    const i = inputRef.current;
    const np = nowPlaying(radioStore.get(), i.reader);
    return { np, target: np?.kind === "article" ? i.articleTarget : i.radioTarget };
  };

  // What the radio session and the live text say changes by itself.
  useEffect(() => {
    const sync = () => {
      const { np, target } = current();
      push({ ...playingFields(np, target), ...(isLive(np?.kind) ? {} : { partial: "", error: null }) });
    };
    const live = () => {
      if (isLive(state.current.kind)) push({ partial: liveText.get().partial, error: liveText.get().error });
    };
    const offRadio = radioStore.subscribe(sync);
    const offLive = liveText.subscribe(live);
    const offCmd = api.onFloatingCommand((cmd) => {
      if (cmd.type === "toggle-play" && isLive(current().np?.kind)) (radioStore.get().playing ? pauseRadio : playRadio)();
      else inputRef.current.onCommand(cmd);
    });
    return () => {
      offRadio();
      offLive();
      offCmd();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { np, target } = current();
  const kind = np?.kind ?? null;
  const radio = radioStore.get();
  const sentences = np?.sentences ?? [];
  const lang = np?.language ?? "";
  const canTranslate = Boolean(lang) && languageInfo(lang).translate && lang !== target;
  const ownKey = `${radio.article?.url}|${target}`;
  const have = input.shownTranslations ?? (own.key === ownKey ? own.map : {});

  // Translations for these few sentences when the main window isn't showing what
  // is playing (it fetches them itself when it is). The main process caches them.
  const missing = isLive(kind) && canTranslate && input.translationOn && !input.shownTranslations ? missingTranslations(sentences, have) : [];
  const missingKey = missing.join("\n");
  useEffect(() => {
    if (!missing.length || !radio.article) return;
    let cancelled = false;
    api.translate(radio.article.id, missing, lang, target).then(
      (out) => !cancelled && setOwn((o) => ({ key: ownKey, map: { ...(o.key === ownKey ? o.map : {}), ...out }, failed: false })),
      () => !cancelled && setOwn((o) => ({ key: ownKey, map: o.key === ownKey ? o.map : {}, failed: true })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, ownKey]);

  const shown = sentences.map((s) => s.text);
  const trimmed = Object.fromEntries(shown.filter((t) => have[t]).map((t) => [t, have[t]]));
  const failed = input.shownTranslations ? input.shownTranslateError : own.key === ownKey && own.failed;
  const savedKey = input.savedForms.join("\n");
  const sentencesKey = sentences.map((s) => s.key).join(",");
  useEffect(() => {
    push({
      ...playingFields(np, target),
      ...(isLive(kind) ? {} : { partial: "", error: null }),
      translations: trimmed,
      translationOn: input.translationOn,
      translationExpected: canTranslate && !failed,
      savedWords: savedWords(input.savedForms),
      dark: input.dark,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, np?.title, np?.url, np?.playing, np?.failed, np?.index, np?.total, sentencesKey, shown.join("\n"), target, input.translationOn, input.dark, savedKey, own, input.shownTranslations, failed]);
}
