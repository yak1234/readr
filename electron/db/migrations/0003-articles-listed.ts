import type { Kysely } from "kysely";

/** Whether an article shows in the library list. Article files the old JSON index never listed
 * (an interrupted save) are kept, and open by id, but stay out of the list as before. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("articles").addColumn("listed", "integer", (c) => c.notNull().defaultTo(1)).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("articles").dropColumn("listed").execute();
}
