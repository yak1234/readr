import { DatabaseSync } from "node:sqlite";
import { Kysely, type Transaction } from "kysely";
import { Migrator } from "kysely/migration";
import { nodeSqliteDialect } from "./node-sqlite-dialect";
import { migrationProvider } from "./migrations";
import type { DB } from "./schema";

export type { DB } from "./schema";

/**
 * Opens (creating if needed) the library database, applies pragmas and runs
 * all pending migrations. Only the main process may call this (single writer).
 */
export async function openDb(file: string): Promise<Kysely<DB>> {
  const raw = new DatabaseSync(file);
  raw.exec(
    "pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;",
  );
  const db = new Kysely<DB>({ dialect: nodeSqliteDialect(raw) });
  try {
    const { error } = await new Migrator({
      db,
      provider: migrationProvider,
    }).migrateToLatest();
    if (error) throw error;
  } catch (e) {
    await db.destroy();
    throw e;
  }
  return db;
}

/** One transaction per user operation: commits on resolve, rolls back on throw. */
export function withTx<T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(fn);
}
