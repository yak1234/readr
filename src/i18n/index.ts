// The chrome's words: one English resource file (en.json), through i18next. The chrome is English in every
// language mode; content (titles, source and section names, transcripts, cards) keeps its own language.
// i18next formats with Intl in the chrome's locale: {{date, datetime(…)}}, {{sources, list}}. Content put
// into a chrome sentence is written {{name, content}}: a bidi isolate, so an Arabic name never reorders the
// English around it. Keys are typed from en.json (./i18next.d.ts), so tsc catches a missing one.

import i18next, { type ParseKeys } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";

/** The chrome's locale: English, with day-month dates and a 24-hour clock ("Monday 9 November", "14:05"). */
export const CHROME_LOCALE = "en-GB";

/** A key of en.json: label tables name their labels with this, so a missing one fails tsc. */
export type ChromeKey = ParseKeys;

/** A bidi isolate: a name in another script never reorders the English around it. */
export const isolate = (text: string) => `⁨${text}⁩`;

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  lng: CHROME_LOCALE,
  fallbackLng: "en",
  resources: { en: { translation: en } }, // en-GB reads the "en" resources
  interpolation: { escapeValue: false }, // React escapes
  returnNull: false,
  initAsync: false,
});
i18n.services.formatter?.add("content", (value) => isolate(String(value)));

/** The Home hint, naming the language's own sources ("Le Monde and Courrier International"), each isolated. */
export function homeHint(sourceNames: string[]): string {
  return i18n.t("home.hint", { sources: sourceNames.map(isolate) });
}
