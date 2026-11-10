import type { Kysely } from "kysely";

/**
 * A live session keeps the translations it was shown, in one language: its target (the first
 * language its sentences were translated into). A past transcript opens with them, untranslated
 * again. Null until something is translated.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // The check is redundant when only these migrations made the table (0001 has no `target`). It stays because
  // this migration has already run on the reader's database and is kept exactly as it ran; it also makes a
  // re-run on a database that somehow has the column harmless (SQLite has no ADD COLUMN IF NOT EXISTS).
  const columns = await db.introspection.getTables().then((t) => t.find((x) => x.name === "live_sessions")?.columns ?? []);
  if (!columns.some((c) => c.name === "target")) await db.schema.alterTable("live_sessions").addColumn("target", "text").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("live_sessions").dropColumn("target").execute();
}
