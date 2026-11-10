// READR_USER_DATA puts Readr's data folder somewhere else for this run: tests, and the packaged app's smoke
// test, which must never open the reader's real library. Imported first by main.ts, so the folder is set
// before anything asks where it is (the single-instance lock is per data folder too).

import { app } from "electron";
import path from "node:path";

if (process.env.READR_USER_DATA) {
  app.setPath("userData", process.env.READR_USER_DATA);
  app.setPath("logs", path.join(process.env.READR_USER_DATA, "logs")); // its logs go with it
}
