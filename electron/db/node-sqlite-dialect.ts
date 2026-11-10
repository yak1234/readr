import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  SqliteDialect,
  type SqliteDatabase,
  type SqliteStatement,
} from "kysely";

/**
 * Kysely dialect over Node's built-in `node:sqlite`. It reuses Kysely's own
 * SqliteDialect and only adapts the driver surface. The community package
 * `kysely-node-sqlite` was rejected: it pins kysely ^0.28 as a dependency,
 * which duplicates (and type-conflicts with) the app's kysely 0.29.
 */
class NodeSqliteDatabase implements SqliteDatabase {
  constructor(private readonly db: DatabaseSync) {}

  close(): void {
    this.db.close();
  }

  prepare(sql: string): SqliteStatement {
    const stmt = this.db.prepare(sql);
    return {
      // Statements that produce columns (SELECT, RETURNING, PRAGMA reads) are readers.
      reader: stmt.columns().length > 0,
      all: (params) => stmt.all(...(params as SQLInputValue[])),
      run: (params) => stmt.run(...(params as SQLInputValue[])),
      iterate: (params) => stmt.iterate(...(params as SQLInputValue[])),
    };
  }
}

export function nodeSqliteDialect(db: DatabaseSync): SqliteDialect {
  return new SqliteDialect({ database: new NodeSqliteDatabase(db) });
}
