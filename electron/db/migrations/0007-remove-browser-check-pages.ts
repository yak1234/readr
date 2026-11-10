import { sql, type Kysely } from "kysely";

// This migration is frozen: it carries its own description of the pages it removes.
//
// Before Readr waited for a site's browser check to pass, it could read the check page itself ("Client
// Challenge … is verifying your browser") and save it as the article. Those copies are removed, so their
// addresses are read again (their translations go with them). A real article is far longer than a check
// page and never has one of these titles with one of these lines in so short a body.

const TITLES = ["Client Challenge", "Just a moment...", "Just a moment…", "Un instant…", "Un instant..."];
const LINES = ["%verifying your browser%", "%Verifying you are human%", "%Checking your browser%", "%Enable JavaScript and cookies to continue%"];
const SHORT_BODY = 4000; // characters of stored JSON

export async function up(db: Kysely<unknown>): Promise<void> {
  const title = sql.join(TITLES.map((t) => sql`${t}`));
  const line = sql.join(LINES.map((l) => sql`body_json like ${l}`), sql` or `);
  const saved = sql`select id from articles where title in (${title}) and length(body_json) < ${SHORT_BODY} and (${line})`;
  await sql`delete from translations where article_id in (${saved})`.execute(db);
  await sql`delete from articles where id in (${saved})`.execute(db);
}

export async function down(): Promise<void> {
  // The removed pages were never articles: nothing to put back.
}
