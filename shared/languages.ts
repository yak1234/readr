// What Readr knows about each language. The data lives in languages.json so the
// Python sidecars can read the same table.

import table from "./languages.json";

export interface LanguageInfo {
  /** ISO 639-1 code ("fr"), or "zh-Hant". */
  code: string;
  /** English name. */
  name: string;
  /** The language's own name for itself. */
  native: string;
  /** Which way its text runs (languages.json's `rtl`): content in it sets `dir` from this. */
  dir: "ltr" | "rtl";
  /** Its usual script, ISO 15924 ("Latn", "Arab"), from Intl's likely subtags: picks the content font. */
  script: string;
  /** For a language whose captions are trained on a standard variety: that variety's English name
   * ("Modern Standard Arabic"), so speech in a dialect may caption badly. */
  standardVariety?: string;
  /** Hy-MT2 can translate it. */
  translate: boolean;
  /** Magpie TTS can read it aloud. Mirrors the NeMo-Speech.cpp runner's Magpie languages (CPP_LANGS in
   * sidecar/tts_server.py), which is why zh and ja are false: only the Python fallback engine has them. */
  speak: boolean;
  /** Nemotron locale ("fr-FR"), or "auto". */
  asr: string;
  /** NVIDIA's quality tier for the language: "ready" for transcription, "broad" coverage, "adaptation" (lower quality). */
  asrTier?: "ready" | "broad" | "adaptation";
  /** Readr's first languages come first in the language switch, in this order (1, 2, 3…). */
  rank?: number;
}

/** A language as languages.json writes it. */
type Fields = Omit<LanguageInfo, "code" | "dir" | "script"> & { rtl: boolean };

interface Row extends Fields {
  /** Lowercase English name Radio Browser files its stations under. */
  radioBrowser: string;
  /** Other names Radio Browser stations use for it ("mandarin"). */
  aliases?: string[];
}

/** The script a language is usually written in, by Intl's likely subtags ("ar" → "Arab"). */
function scriptOf(code: string): string {
  try {
    return new Intl.Locale(code).maximize().script ?? "Latn";
  } catch {
    return "Latn";
  }
}

const withDerived = (code: string, { rtl, ...row }: Fields): LanguageInfo => ({
  code,
  ...row,
  dir: rtl ? "rtl" : "ltr",
  script: scriptOf(code),
});

export const LANGUAGES: Record<string, LanguageInfo> = Object.fromEntries(
  Object.entries(table as Record<string, Row>).map(([code, { radioBrowser, aliases, ...row }]) => [code, withDerived(code, row)]),
);

/** The language shown before anything has content, and an article's when nothing says otherwise: the first ranked. */
export const DEFAULT_LANG: string = Object.values(LANGUAGES).filter((l) => l.rank).sort((a, b) => a.rank! - b.rank!)[0]?.code ?? "en";

export const TRANSLATABLE: string[] = Object.keys(LANGUAGES).filter((c) => LANGUAGES[c].translate);

export function languageInfo(code: string): LanguageInfo {
  return (Object.hasOwn(LANGUAGES, code) ? LANGUAGES[code] : undefined) ?? withDerived(code, { name: code, native: code, rtl: false, translate: false, speak: false, asr: "auto" });
}

const ALIASES = new Map<string, string>();
for (const [code, { radioBrowser, aliases }] of Object.entries(table as Record<string, Row>)) {
  const info = LANGUAGES[code];
  for (const alias of [info.code, info.name, info.native, radioBrowser, ...(aliases ?? [])]) {
    if (alias) ALIASES.set(alias.toLowerCase(), info.code);
  }
}

/** Radio Browser's `language` value ("arabic,french", "ar") as unique ISO codes, in order. */
export function normaliseLanguageTags(tags: string): string[] {
  const codes: string[] = [];
  for (const tag of tags.split(",")) {
    const code = ALIASES.get(tag.trim().toLowerCase());
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Scripts that point at a language, with every Readr language written in each (the first is the one a
 * word in that script is taken to be in). Latin and other widely shared scripts are left out: they say nothing. */
const SCRIPTS: { script: RegExp; langs: string[] }[] = [
  { script: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, langs: ["ja"] },
  { script: /\p{Script=Arabic}/u, langs: ["ar", "fa", "ur", "ug", "ps", "ku"] },
  { script: /\p{Script=Cyrillic}/u, langs: ["ru", "uk", "bg", "sr", "kk", "mn", "mk", "be", "bs"] },
  { script: /\p{Script=Han}/u, langs: ["zh", "zh-Hant", "ja"] },
  { script: /\p{Script=Hangul}/u, langs: ["ko"] },
  { script: /\p{Script=Hebrew}/u, langs: ["he"] },
  { script: /\p{Script=Greek}/u, langs: ["el"] },
  { script: /\p{Script=Devanagari}/u, langs: ["hi", "mr", "ne"] },
  { script: /\p{Script=Thai}/u, langs: ["th"] },
  { script: /\p{Script=Bengali}/u, langs: ["bn"] },
  { script: /\p{Script=Tamil}/u, langs: ["ta"] },
  { script: /\p{Script=Telugu}/u, langs: ["te"] },
  { script: /\p{Script=Gujarati}/u, langs: ["gu"] },
  { script: /\p{Script=Kannada}/u, langs: ["kn"] },
  { script: /\p{Script=Malayalam}/u, langs: ["ml"] },
  { script: /\p{Script=Gurmukhi}/u, langs: ["pa"] },
  { script: /\p{Script=Sinhala}/u, langs: ["si"] },
  { script: /\p{Script=Lao}/u, langs: ["lo"] },
  { script: /\p{Script=Khmer}/u, langs: ["km"] },
  { script: /\p{Script=Myanmar}/u, langs: ["my"] },
  { script: /\p{Script=Georgian}/u, langs: ["ka"] },
  { script: /\p{Script=Armenian}/u, langs: ["hy"] },
  { script: /\p{Script=Ethiopic}/u, langs: ["am"] },
  { script: /\p{Script=Tibetan}/u, langs: ["bo"] },
];

/** The telling script most of the text's letters are in (kana marks Japanese even beside Han). */
function telltaleScript(text: string): (typeof SCRIPTS)[number] | null {
  const counts = new Map<(typeof SCRIPTS)[number], number>();
  for (const ch of text) {
    const s = SCRIPTS.find((x) => x.script.test(ch));
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (counts.has(SCRIPTS[0])) return SCRIPTS[0];
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** `lang`, unless the text's script can't be written in it: then the script's language. */
export function languageForText(text: string, lang: string): string {
  const s = telltaleScript(text);
  return !s || s.langs.includes(lang) ? lang : s.langs[0];
}
