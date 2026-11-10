// Bringing the library up: open the database, run the one-time JSON upgrade, and only then
// let the library be used. A failed upgrade leaves the library unavailable until Try again works.

import { sql, type Kysely } from "kysely";
import type { DB } from "./db";
import type { ImportOptions, ImportResult } from "./db/migrate-json";
import { createLibrary, type Library } from "./library";
import type { StartupState } from "../shared/types";

export interface LibraryStartupDeps {
  dbFile: string;
  libraryDir: string;
  open(file: string): Promise<Kysely<DB>>;
  importLibrary(db: Kysely<DB>, libraryDir: string, opts: ImportOptions): Promise<ImportResult>;
  /** Hands the ready library to its users (store.ts). */
  attach(library: Library): void;
  /** Runs once on the upgraded database before anything may use it (ends live sessions a crash left open). */
  prepare?(db: Kysely<DB>): Promise<void>;
}

export class LibraryStartup {
  private db: Promise<Kysely<DB>> | null = null;
  /** The database once the library is ready, for callers that must never wait (live captions). */
  private readyDb: Kysely<DB> | null = null;
  private outcome: Promise<StartupState> | null = null;
  private fallbackLang = "";
  private requested!: () => void;
  /** Settles once the renderer has asked for the library (it supplies the app's language). */
  private readonly asked = new Promise<void>((resolve) => (this.requested = resolve));

  constructor(private readonly deps: LibraryStartupDeps) {}

  /** Starts opening the database (and applying its migrations). */
  open(): void {
    if (this.db) return;
    this.db = this.deps.open(this.deps.dbFile);
    this.db.catch(() => undefined); // reported by the upgrade that awaits it
  }

  /** The library's state. The first call runs the upgrade; `currentLang` is the app's language,
   * the last resort for an old saved word's language. */
  state(currentLang: string): Promise<StartupState> {
    if (!this.outcome) {
      this.fallbackLang = currentLang;
      this.outcome = this.run();
      this.requested();
    }
    return this.outcome;
  }

  /** Runs the upgrade without the app's language if nothing has asked for it within `ms`, so
   * nothing waiting on the library waits forever (say, a window that failed to load). */
  startAfter(ms: number): void {
    setTimeout(() => {
      if (!this.outcome) void this.state("");
    }, ms).unref?.();
  }

  /** Try again after a failed upgrade. */
  async retry(): Promise<StartupState> {
    const current = this.outcome ? await this.outcome : null;
    if (current?.library === "ready") return current;
    this.outcome = this.run();
    this.requested();
    return this.outcome;
  }

  /** The state once the upgrade (asked for by the main window at start) has run, without starting it. */
  async settled(): Promise<StartupState> {
    await this.asked;
    return this.outcome!;
  }

  /** Whether the library can be used: waits for the upgrade. */
  async ready(): Promise<boolean> {
    return (await this.settled()).library === "ready";
  }

  /** The open database once the library is ready, else null (the upgrade failed or is pending). */
  async database(): Promise<Kysely<DB> | null> {
    return (await this.ready()) && this.db ? this.db : null;
  }

  /** The database if the library is ready right now, else null; never waits. */
  current(): Kysely<DB> | null {
    return this.readyDb;
  }

  async close(): Promise<void> {
    this.readyDb = null;
    const db = await this.db?.catch(() => null);
    this.db = null;
    if (!db) return;
    // One connection, taken in turn: this query waits for any transaction in progress (a review, an add)
    // to commit, so quitting never closes the database under it.
    await sql`select 1`.execute(db).catch(() => undefined);
    await db.destroy();
  }

  private async run(): Promise<StartupState> {
    try {
      this.open();
      const db = await this.db!.catch((e) => {
        this.db = null; // Try again reopens it
        throw e;
      });
      const result = await this.deps.importLibrary(db, this.deps.libraryDir, { fallbackLang: this.fallbackLang });
      if (result.articles || result.examples || result.skipped) console.log("Library upgraded:", result);
      await this.deps.prepare?.(db).catch((e) => console.error("Preparing the library failed:", e));
      this.deps.attach(createLibrary(db));
      this.readyDb = db;
      return { library: "ready" };
    } catch (e) {
      console.error("Library upgrade failed:", e);
      return { library: "upgrade-failed", message: e instanceof Error ? e.message : String(e) };
    }
  }
}
