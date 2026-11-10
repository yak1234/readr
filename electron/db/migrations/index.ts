import type { MigrationProvider } from "kysely/migration";
import * as m0001 from "./0001-initial";
import * as m0002 from "./0002-repair-card-languages";
import * as m0003 from "./0003-articles-listed";
import * as m0004 from "./0004-fsrs7-cards";
import * as m0005 from "./0005-live-history-indexes";
import * as m0006 from "./0006-live-session-target";
import * as m0007 from "./0007-remove-browser-check-pages";

/**
 * Static provider: migrations are imported, not discovered on disk, so they
 * are bundled with the code and work inside the packaged app. Keys sort
 * lexicographically, so keep the numeric prefix.
 */
export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return {
      "0001-initial": m0001,
      "0002-repair-card-languages": m0002,
      "0003-articles-listed": m0003,
      "0004-fsrs7-cards": m0004,
      "0005-live-history-indexes": m0005,
      "0006-live-session-target": m0006,
      "0007-remove-browser-check-pages": m0007,
    };
  },
};
