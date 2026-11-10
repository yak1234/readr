import { sql, type Kysely } from "kysely";

/** Ids are text (caller-generated); times are epoch milliseconds. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("meta")
    .addColumn("key", "text", (c) => c.primaryKey())
    .addColumn("value", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("articles")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("url", "text", (c) => c.notNull())
    .addColumn("lang", "text", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("added_at", "integer", (c) => c.notNull())
    .addColumn("summary_json", "text")
    .addColumn("body_json", "text")
    .execute();

  await db.schema
    .createTable("translations")
    .addColumn("article_id", "text", (c) =>
      c.notNull().references("articles.id").onDelete("cascade"),
    )
    .addColumn("target_lang", "text", (c) => c.notNull())
    .addColumn("sentence", "integer", (c) => c.notNull())
    .addColumn("text", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("translations_pk", [
      "article_id",
      "target_lang",
      "sentence",
    ])
    .execute();

  await db.schema
    .createTable("cards")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("lang", "text", (c) => c.notNull())
    .addColumn("form", "text", (c) => c.notNull())
    .addColumn("form_key", "text", (c) => c.notNull())
    .addColumn("translation", "text", (c) => c.notNull())
    .addColumn("definition", "text")
    .addColumn("created_at", "integer", (c) => c.notNull())
    .addColumn("suspended", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("fsrs_json", "text", (c) => c.notNull())
    .addColumn("due", "integer", (c) => c.notNull())
    .addColumn("is_new", "integer", (c) => c.notNull().defaultTo(1))
    .addUniqueConstraint("cards_identity", ["lang", "form_key"])
    .execute();

  await db.schema
    .createIndex("cards_queue")
    .on("cards")
    .columns(["lang", "suspended", "due"])
    .execute();

  await db.schema
    .createTable("card_examples")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("card_id", "text", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("sentence", "text", (c) => c.notNull())
    .addColumn("sentence_translation", "text")
    .addColumn("source_kind", "text", (c) =>
      c.notNull().check(sql`source_kind in ('article', 'radio', 'tv')`),
    )
    .addColumn("source_id", "text")
    .addColumn("source_title", "text")
    .addColumn("source_url", "text")
    .addColumn("at", "integer", (c) => c.notNull())
    .addColumn("span_start", "integer")
    .addColumn("span_end", "integer")
    .addColumn("live_sentence_id", "text")
    .addColumn("clip", "blob")
    .execute();

  await db.schema
    .createIndex("card_examples_card")
    .on("card_examples")
    .column("card_id")
    .execute();

  await db.schema
    .createTable("reviews")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("card_id", "text", (c) =>
      c.notNull().references("cards.id").onDelete("cascade"),
    )
    .addColumn("rating", "integer", (c) => c.notNull())
    .addColumn("reviewed_at", "integer", (c) => c.notNull())
    .addColumn("log_json", "text", (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex("reviews_card")
    .on("reviews")
    .columns(["card_id", "reviewed_at"])
    .execute();

  await db.schema
    .createTable("live_sessions")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("station_id", "text")
    .addColumn("station_name", "text")
    .addColumn("lang", "text", (c) => c.notNull())
    .addColumn("started_at", "integer", (c) => c.notNull())
    .addColumn("ended_at", "integer")
    .execute();

  await db.schema
    .createTable("live_sentences")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("session_id", "text", (c) =>
      c.notNull().references("live_sessions.id").onDelete("cascade"),
    )
    .addColumn("t", "real", (c) => c.notNull())
    .addColumn("text", "text", (c) => c.notNull())
    .addColumn("translation", "text")
    .execute();

  await db.schema
    .createIndex("live_sentences_session")
    .on("live_sentences")
    .columns(["session_id", "t"])
    .execute();

  await db.schema
    .createTable("activity")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("at", "integer", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull())
    .addColumn("ref", "text")
    .addColumn("amount", "real", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema.createIndex("activity_at").on("activity").column("at").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of [
    "activity",
    "live_sentences",
    "live_sessions",
    "reviews",
    "card_examples",
    "cards",
    "translations",
    "articles",
    "meta",
  ]) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
