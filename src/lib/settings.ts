import { useEffect, useState } from "react";
import type { FocusMode, ReadingFont, ReadingStyle, ViewMode } from "./theme";

export interface Settings {
  readingStyle: ReadingStyle;
  fontSize: number; // percent, 80-160
  font: ReadingFont;
  focusMode: FocusMode;
  viewMode: ViewMode;
  blurTranslation: boolean; // hide translations until hover
  showRightPanel: boolean;
  voiceURI: string;
  speechRate: number;
}

const DEFAULTS: Settings = {
  readingStyle: "light",
  fontSize: 100,
  font: "georgia",
  focusMode: "off",
  viewMode: "interlinear",
  blurTranslation: false,
  showRightPanel: true,
  voiceURI: "",
  speechRate: 1,
};

const KEY = "readr.settings.v1";

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  }, [settings]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return [settings, update] as const;
}
