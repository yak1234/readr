import { useCallback, useEffect, useState } from "react";
import type { FocusMode, ReadingFont, ReadingStyle, ViewMode } from "./theme";
import type { Lang } from "../../shared/types";

export interface Settings {
  readingStyle: ReadingStyle;
  fontSize: number; // percent, 80-160
  font: ReadingFont;
  focusMode: FocusMode;
  viewMode: ViewMode;
  /** Language translations are shown in. */
  targetLang: string;
  blurTranslation: boolean; // hide translations until hover
  showRightPanel: boolean;
  /** The left panel is hidden (the title bar's panel icon and ⌘\ bring it back). */
  sidebarHidden: boolean;
  voiceURI: string;
  speechRate: number;
  /** The language the app shows ("" until one is chosen: then the first with content). */
  currentLang: string;
  /** Sidebar drawers from before the language switch; kept readable, no longer used. */
  openDrawers: string[];
  /** Minutes of a live radio transcript to keep: 15, 30, 60, or 0 for all of it. */
  liveWindowMinutes: 15 | 30 | 60 | 0;
  /** Language each radio station is translated into (by station address); others use targetLang. */
  stationTargets: Record<string, string>;
  /** Live subtitles over the TV picture (the stacked layout, under 1,100 px). */
  tvSubtitles: boolean;
  /** Live subtitles over the TV picture beside the teleprompter (off by default: the captions are beside it). */
  tvSideSubtitles: boolean;
  /** New flashcards introduced per study day (per language). */
  newCardsPerDay: number;
}

export const DEFAULT_SETTINGS: Settings = {
  readingStyle: "light",
  fontSize: 100,
  font: "georgia",
  focusMode: "off",
  viewMode: "interlinear",
  targetLang: "en",
  blurTranslation: false,
  showRightPanel: true,
  sidebarHidden: false,
  voiceURI: "",
  speechRate: 1,
  currentLang: "",
  openDrawers: ["articles:fr", "live:fr"],
  liveWindowMinutes: 60,
  stationTargets: {},
  tvSubtitles: true,
  tvSideSubtitles: false,
  newCardsPerDay: 20,
};

const KEY = "readr.settings.v1";

export const MAX_NEW_CARDS_PER_DAY = 200;

/** A whole number of new cards from 0 to the maximum; anything else is the default. */
export function clampNewCardsPerDay(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(MAX_NEW_CARDS_PER_DAY, Math.max(0, Math.floor(v))) : DEFAULT_SETTINGS.newCardsPerDay;
}

/** Saved settings (JSON) over the defaults; values that would break something are corrected. */
export function parseSettings(raw: string | null): Settings {
  try {
    const saved = JSON.parse(raw || "{}");
    const s: Settings = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === "object" ? saved : {}) };
    return { ...s, newCardsPerDay: clampNewCardsPerDay(s.newCardsPerDay) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function load(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_SETTINGS; // storage unavailable
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
  // Stable, so components that take it don't redraw each time a setting changes.
  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value })), []);
  return [settings, update] as const;
}

/** The key an older version saved a drawer under: a bare language for articles
 * ("fr"), and "videos:<lang>" for what is now "live:<lang>". */
function legacyKey(key: string): string | null {
  if (key.startsWith("articles:")) return key.slice("articles:".length);
  if (key.startsWith("live:")) return `videos:${key.slice("live:".length)}`;
  return null;
}

/** Whether a sidebar drawer is open. */
export function drawerOpen(open: string[], key: string): boolean {
  const legacy = legacyKey(key);
  return open.includes(key) || (legacy !== null && open.includes(legacy));
}

export function toggleDrawer(open: string[], key: string): string[] {
  const legacy = legacyKey(key);
  const rest = open.filter((k) => k !== key && k !== legacy);
  return drawerOpen(open, key) ? rest : [...rest, key];
}

/** The language a station's or TV channel's captions are translated into. */
export function stationTarget(settings: Pick<Settings, "stationTargets" | "targetLang">, stationUrl: string): string {
  return settings.stationTargets[stationUrl] ?? settings.targetLang;
}
