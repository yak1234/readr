// The language showing, as everything that lays out or formats its content needs it: direction, BCP 47
// locale, content font, Intl date and relative-time formatters, and the language's own sources. What a
// language is like comes from shared/languages.json (languageInfo); no component checks a language code.
// The chrome stays English and left to right (src/i18n); only content takes this scope's direction.

import React, { createContext, useContext, useMemo } from "react";
import { languageInfo } from "../../shared/languages";
import { CHROME_LOCALE } from "../i18n";
import { contentFont, contentScale, SERIF } from "./theme";

export interface LanguageScopeValue {
  lang: string;
  /** Its English name ("Arabic") and its own ("العربية"). */
  name: string;
  native: string;
  dir: "ltr" | "rtl";
  /** BCP 47 locale for the content's Intl formatting. */
  locale: string;
  /** The face its text is set in (its script's own, else the reading serif). */
  contentFont: string;
  /** How much larger its script is set (1 for most). */
  contentScale: number;
  /** Its script's own face if it has one, else `base` (the reader's chosen font, the UI font, "inherit"). */
  fontOver(base: string): string;
  /** Read aloud by Magpie; translated by Hy-MT2. */
  speak: boolean;
  translate: boolean;
  /** A content date, in the content's locale ("6 nov."). */
  formatDate(ms: number): string;
  /** How long ago, in the content's locale ("il y a 5 minutes"); a date after a day; "" when unknown. */
  formatRelative(ms: number, now?: number): string;
  /** The language's sources by name ("Le Monde", "Courrier International"). */
  sourceNames: string[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The code as a locale Intl accepts, else the chrome's. */
function localeOf(code: string): string {
  try {
    return Intl.getCanonicalLocales(code)[0] ?? CHROME_LOCALE;
  } catch {
    return CHROME_LOCALE;
  }
}

interface Formatters {
  date: Intl.DateTimeFormat;
  relative: Intl.RelativeTimeFormat;
}
const formatters = new Map<string, Formatters>();
function formattersFor(locale: string): Formatters {
  let f = formatters.get(locale);
  if (!f) {
    f = { date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }), relative: new Intl.RelativeTimeFormat(locale, { numeric: "always" }) };
    formatters.set(locale, f);
  }
  return f;
}

/** The scope of one language (also for content in a language other than the one showing: a card, a story). */
export function languageScope(lang: string, sourceNames: string[] = []): LanguageScopeValue {
  const info = languageInfo(lang);
  const locale = localeOf(lang);
  const f = formattersFor(locale);
  const formatDate = (ms: number) => (ms ? f.date.format(ms) : "");
  return {
    lang,
    name: info.name,
    native: info.native,
    dir: info.dir,
    locale,
    contentFont: contentFont(info.script, SERIF),
    contentScale: contentScale(info.script),
    fontOver: (base) => contentFont(info.script, base),
    speak: info.speak,
    translate: info.translate,
    formatDate,
    formatRelative(ms, now = Date.now()) {
      if (!ms) return "";
      const ago = Math.max(0, now - ms);
      if (ago < HOUR) return f.relative.format(-Math.max(1, Math.round(ago / MIN)), "minute");
      if (ago < DAY) return f.relative.format(-Math.round(ago / HOUR), "hour");
      return formatDate(ms);
    },
    sourceNames,
  };
}

const Scope = createContext<LanguageScopeValue>(languageScope(""));

/** Provides the language showing to everything inside it. `sourceNames` is memoised by the caller. */
export function LanguageScope({ lang, sourceNames, children }: { lang: string; sourceNames: string[]; children: React.ReactNode }) {
  const value = useMemo(() => languageScope(lang, sourceNames), [lang, sourceNames]);
  return <Scope.Provider value={value}>{children}</Scope.Provider>;
}

export const useLanguageScope = (): LanguageScopeValue => useContext(Scope);
