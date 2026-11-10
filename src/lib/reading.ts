import type { Article } from "../../shared/types";

/** The sentences of an article in reading order, each with its "block:sentence" key. */
export function flattenArticle(article: Article | null): { keys: string[]; sentences: string[] } {
  const keys: string[] = [];
  const sentences: string[] = [];
  article?.blocks.forEach((b, bi) => b.sentences.forEach((s, si) => {
    keys.push(`${bi}:${si}`);
    sentences.push(s);
  }));
  return { keys, sentences };
}
