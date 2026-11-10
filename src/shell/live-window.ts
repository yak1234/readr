// What a live transcript keeps: the window chosen in the settings, and any paragraph with a sentence a card
// was made from.

import { useEffect } from "react";
import { useLiveExampleSentences } from "../lib/cards-hooks";
import { setRadioWindow } from "../lib/radio-session";
import { useReadrSettings } from "./settings-provider";

export function useLiveWindow() {
  const { settings } = useReadrSettings();
  const heard = useLiveExampleSentences();
  useEffect(() => {
    const saved = new Set(heard);
    setRadioWindow(settings.liveWindowMinutes, (sentence) => saved.has(sentence));
  }, [heard, settings.liveWindowMinutes]);
}
