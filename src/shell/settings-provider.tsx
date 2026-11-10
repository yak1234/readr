// The reading settings, held once for the whole window, with the theme tokens they imply.

import React, { createContext, useContext, useMemo } from "react";
import { useSettings, type Settings } from "../lib/settings";
import { chromeTokens, readingTokens, type ChromeTokens, type ReadingTokens } from "../lib/theme";

export interface SettingsValue {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** The chrome's colours and the reading page's, for the chosen style. */
  c: ChromeTokens;
  tokens: ReadingTokens;
  dark: boolean;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, update] = useSettings();
  const value = useMemo(
    () => ({ settings, update, c: chromeTokens(settings.readingStyle), tokens: readingTokens[settings.readingStyle], dark: settings.readingStyle === "dark" }),
    [settings, update],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useReadrSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useReadrSettings outside SettingsProvider");
  return value;
}
