import type { Article } from "./types";

/** Up to `max` sentences before `index`, oldest first: what the translator reads for context. */
export function contextFor(sentences: string[], index: number, max = 3): string[] {
  return sentences.slice(Math.max(0, index - max), Math.max(0, index));
}

/** The saved translations of an article into one language. The legacy `translations` are never read. */
export function translationsFor(article: Pick<Article, "translationsTo">, tgt: string): Record<string, string> {
  return article.translationsTo?.[tgt] ?? {};
}

/** Live sentences seen so far, in order, without repeats, keeping the last `cap`. */
export function appendHistory(history: string[], sentences: string[], cap = 50): string[] {
  const seen = new Set(history);
  const next = [...history];
  for (const s of sentences) if (!seen.has(s)) (seen.add(s), next.push(s));
  return next.slice(-cap);
}

/** Drops blank translations (misses) so they are never recorded as done. */
export function withoutBlanks(out: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(out).filter(([, t]) => t.trim()));
}

/** Pairs sentences with the translator's output, dropping empty or missing results so they are retried. */
export function usableTranslations(sentences: string[], out: string[]): Record<string, string> {
  const res: Record<string, string> = {};
  sentences.forEach((s, i) => {
    if (out[i]) res[s] = out[i];
  });
  return res;
}

/** How an article in `src` is shown for target `tgt`: translated, quietly as the original
 * (same language), or untranslatable (the language is outside the translator's set). */
export function translationPlan(src: string, tgt: string, translatable: boolean): "ok" | "same" | "unsupported" {
  if (src === tgt) return "same";
  return translatable ? "ok" : "unsupported";
}
