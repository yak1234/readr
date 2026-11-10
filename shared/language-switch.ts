// Which languages the language switch offers, and which one is showing.

import { DEFAULT_LANG, languageInfo } from "./languages";

/** Readr's first languages come first, by their rank in languages.json; the rest follow by name. */
export function orderLangs(langs: Iterable<string>): string[] {
  const rank = (l: string) => languageInfo(l).rank ?? Infinity;
  return [...new Set(langs)].sort((a, b) => rank(a) - rank(b) || languageInfo(a).name.localeCompare(languageInfo(b).name));
}

/** Languages with something in them: followed feeds, saved stations and TV
 * channels, saved articles (a live transcript is not one) and sources with every
 * section unticked. */
export function languagesWithContent(
  feeds: { lang: string }[],
  stations: { lang: string }[],
  library: { language: string; kind?: string }[],
  sites: { lang: string }[] = [],
  channels: { lang: string }[] = [],
): string[] {
  return orderLangs([
    ...feeds.map((f) => f.lang),
    ...sites.map((s) => s.lang),
    ...stations.map((s) => s.lang),
    ...channels.map((c) => c.lang),
    ...library.filter((a) => a.kind !== "radio" && a.kind !== "tv").map((a) => a.language),
  ]);
}

/** The language's sources by name, once each: its sites (one with every section unticked still counts),
 * then the sources of its followed feeds. */
export function sourceNamesFor(lang: string, sites: { name: string; lang: string }[], feeds: { source: string; lang: string }[]): string[] {
  return [...new Set([...sites.filter((s) => s.lang === lang).map((s) => s.name), ...feeds.filter((f) => f.lang === lang).map((f) => f.source)])];
}

/** The language to show: the saved one while it still has content, else the first that does, else the default (French). */
export function defaultLang(settings: { currentLang: string }, available: string[]): string {
  if (settings.currentLang && available.includes(settings.currentLang)) return settings.currentLang;
  return available[0] ?? DEFAULT_LANG;
}
