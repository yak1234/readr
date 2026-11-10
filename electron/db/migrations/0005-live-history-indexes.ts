import type { Kysely } from "kysely";

/**
 * The live history is pruned daily: sessions by age, and a sentence only when no card example
 * names it. Both lookups get an index.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.createIndex("live_sessions_started").ifNotExists().on("live_sessions").column("started_at").execute();
  await db.schema.createIndex("card_examples_live_sentence").ifNotExists().on("card_examples").column("live_sentence_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("card_examples_live_sentence").ifExists().execute();
  await db.schema.dropIndex("live_sessions_started").ifExists().execute();
}
