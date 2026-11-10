// How the review screen words things: intervals, the marked phrase in its sentence, and the source line.

import { findSpan, type CardExample } from "../../shared/cards";
import { CHROME_LOCALE, i18n } from "../i18n";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Unit = "minute" | "hour" | "day" | "month" | "year";
const unitFormats = new Map<string, Intl.NumberFormat>();
/** "10 minutes", "1.5 months": one Intl.NumberFormat per unit and precision, made once. */
function unit(u: Unit, n: number, digits = 0): string {
  const key = `${u}|${digits}`;
  let f = unitFormats.get(key);
  if (!f) unitFormats.set(key, (f = new Intl.NumberFormat(CHROME_LOCALE, { style: "unit", unit: u, unitDisplay: "long", maximumFractionDigits: digits })));
  return f.format(n);
}

/** A wait (ms) in its largest unit, rounded: "10 minutes", "4 days", "1.5 months". A wait a moment
 * short of a unit reads as that unit (23 h 59 min is "1 day"). */
export function intervalLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MIN));
  if (minutes < 60) return unit("minute", minutes);
  const hours = Math.round(ms / HOUR);
  if (hours < 24) return unit("hour", hours);
  const days = Math.round(ms / DAY);
  if (days < 30) return unit("day", days);
  const months = Math.round((ms / (30 * DAY)) * 10) / 10;
  if (days < 365) return unit("month", months, 1);
  return unit("year", ms / (365 * DAY), 1);
}

/** When learning cards come back: "Back in 10 min", "Back in 2 h 10 min". */
export function backIn(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MIN));
  const h = Math.floor(minutes / 60);
  const wait = h ? i18n.t("time.hoursMinutes", { hours: h, minutes: minutes % 60 }) : i18n.t("time.minutes", { minutes });
  return i18n.t("time.backIn", { wait });
}

const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** [start, end] widened to the words it touches, by the language's own word boundaries. */
function wholeWords(sentence: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  for (const w of words.segment(sentence)) {
    const wEnd = w.index + w.segment.length;
    if (w.isWordLike && w.index < end && wEnd > start) {
      from = Math.min(from, w.index);
      to = Math.max(to, wEnd);
    }
  }
  return [from, to];
}

/**
 * The sentence split around the phrase: [before, phrase, after]. The stored span (UTF-16 offsets)
 * when it is usable; else, for examples saved before spans were kept, the form found in the sentence
 * ignoring case, widened to whole words ("archive" marks "archives"). Nothing found: ["sentence", "", ""].
 */
export function markedSentence(sentence: string, span: [number, number] | null, form: string): [string, string, string] {
  let at = span && span[0] >= 0 && span[0] < span[1] && span[1] <= sentence.length ? span : null;
  if (!at) {
    const found = findSpan(sentence, form);
    if (found) at = wholeWords(sentence, found[0], found[1]);
  }
  return at ? [sentence.slice(0, at[0]), sentence.slice(at[0], at[1]), sentence.slice(at[1])] : [sentence, "", ""];
}

const dayMonth = new Intl.DateTimeFormat(CHROME_LOCALE, { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat(CHROME_LOCALE, { day: "numeric", month: "short", year: "numeric" });
const clock = new Intl.DateTimeFormat(CHROME_LOCALE, { hour: "2-digit", minute: "2-digit" });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "Le Monde · 3 Nov" for an article; "Asharq · 14:05" for radio or TV heard today ("7 Nov, 08:30" before). */
export function sourceLine(e: Pick<CardExample, "sourceKind" | "sourceName" | "sourceTitle" | "at">, now: Date): string {
  const when = new Date(e.at);
  const day = (when.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear).format(when);
  const date = e.sourceKind === "article" ? day : sameDay(when, now) ? clock.format(when) : i18n.t("time.dayTime", { day, time: clock.format(when) });
  const name = e.sourceName || e.sourceTitle;
  return name ? i18n.t("time.sourceDate", { source: name, date }) : date;
}
