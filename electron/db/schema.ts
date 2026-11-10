/** Kysely table types. All times are epoch milliseconds. */

import type { Generated } from "kysely";

export interface MetaTable {
  key: string;
  value: string;
}

export interface ArticlesTable {
  id: string;
  url: string;
  lang: string;
  title: string;
  source: string;
  kind: string;
  added_at: number;
  summary_json: string | null;
  body_json: string | null;
  /** 1 when the article shows in the library list (0: kept, but never listed). */
  listed: Generated<number>;
}

export interface TranslationsTable {
  article_id: string;
  target_lang: string;
  sentence: number;
  text: string;
}

export interface CardsTable {
  id: string;
  lang: string;
  form: string;
  form_key: string;
  translation: string;
  definition: string | null;
  created_at: number;
  suspended: number;
  fsrs_json: string;
  due: number;
  is_new: number;
}

export type ExampleSourceKind = "article" | "radio" | "tv";

export interface CardExamplesTable {
  id: string;
  card_id: string;
  sentence: string;
  sentence_translation: string | null;
  source_kind: ExampleSourceKind;
  source_id: string | null;
  source_title: string | null;
  source_url: string | null;
  at: number;
  /** Character offsets of the phrase within `sentence`. */
  span_start: number | null;
  span_end: number | null;
  live_sentence_id: string | null;
  clip: Uint8Array | null;
}

export interface ReviewsTable {
  id: string;
  card_id: string;
  rating: number;
  reviewed_at: number;
  log_json: string;
}

export interface LiveSessionsTable {
  id: string;
  kind: string;
  station_id: string | null;
  station_name: string | null;
  lang: string;
  started_at: number;
  ended_at: number | null;
  /** The language its sentences' stored translations are in (migration 0006); null until one is kept. */
  target: string | null;
}

export interface LiveSentencesTable {
  id: string;
  session_id: string;
  t: number;
  text: string;
  translation: string | null;
}

export interface ActivityTable {
  id: string;
  at: number;
  kind: string;
  ref: string | null;
  amount: number;
}

export interface DB {
  meta: MetaTable;
  articles: ArticlesTable;
  translations: TranslationsTable;
  cards: CardsTable;
  card_examples: CardExamplesTable;
  reviews: ReviewsTable;
  live_sessions: LiveSessionsTable;
  live_sentences: LiveSentencesTable;
  activity: ActivityTable;
}
