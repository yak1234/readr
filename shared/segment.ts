// Sentence segmentation tuned for French news prose.
// Intl.Segmenter does the heavy lifting; we then re-join splits that happen
// after common abbreviations ("M.", "Mme", "av. J.-C.", initials...).

const ABBREVIATIONS = new Set(
  [
    "m", "mm", "mme", "mmes", "mlle", "mlles", "dr", "pr", "me", "mgr", "st", "ste",
    "etc", "cf", "p", "pp", "vol", "no", "n°", "art", "chap", "fig", "env", "av", "apr",
    "j.-c", "jc", "ex", "éd", "ed", "coll", "op", "cit", "ibid", "dép", "gén", "lt", "col",
    "cdt", "cne", "sgt", "adj", "min", "max", "hab", "km", "mr", "mrs", "ms", "jr", "sr",
    "vs", "inc", "ltd", "co", "corp", "u.s", "e.g", "i.e",
  ].map((s) => s.toLowerCase()),
);

function endsWithAbbreviation(chunk: string): boolean {
  const trimmed = chunk.trimEnd();
  if (!trimmed.endsWith(".")) return false;
  const lastToken = trimmed.slice(0, -1).split(/[\s(«"“]+/).pop() ?? "";
  if (!lastToken) return false;
  // Single capital initial: "J. K. Rowling", "E. Macron"
  if (/^\p{Lu}$/u.test(lastToken)) return true;
  return ABBREVIATIONS.has(lastToken.toLowerCase());
}

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(lang: string): Intl.Segmenter {
  if (!segmenter) segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  return segmenter;
}

export function splitSentences(text: string, lang = "fr"): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const raw = Array.from(getSegmenter(lang).segment(clean), (s) => s.segment);

  const merged: string[] = [];
  for (const piece of raw) {
    const prev = merged[merged.length - 1];
    const continuesLowercase = /^\s*\p{Ll}/u.test(piece) && !/[.!?…»"”]\s*$/u.test(prev ?? "");
    if (prev !== undefined && (endsWithAbbreviation(prev) || continuesLowercase)) {
      merged[merged.length - 1] = prev + piece;
    } else {
      merged.push(piece);
    }
  }
  return merged.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Split a sentence into word and non-word tokens, keeping French elisions
 * ("l'économie" → "l'", "économie") so each word is clickable on its own. */
export interface Token {
  text: string;
  isWord: boolean;
}

// Elided clitics (l', d', qu', jusqu'…) become their own token; any other
// apostrophe stays inside the word (aujourd'hui, presqu'île).
const WORD_RE =
  /((?<![\p{L}\p{M}])(?:[lLdDjJmMnNsStTcC]|[qQ]u|[jJ]usqu|[lL]orsqu|[pP]uisqu|[qQ]uoiqu)['’](?=[\p{L}\p{M}])|[\p{L}\p{M}](?:[\p{L}\p{M}'’\-]*[\p{L}\p{M}])?|\d+(?:[.,]\d+)*)/gu;

export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of sentence.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > last) tokens.push({ text: sentence.slice(last, start), isWord: false });
    const isNumber = /^\d/.test(m[0]);
    tokens.push({ text: m[0], isWord: !isNumber });
    last = start + m[0].length;
  }
  if (last < sentence.length) tokens.push({ text: sentence.slice(last), isWord: false });
  return tokens;
}
