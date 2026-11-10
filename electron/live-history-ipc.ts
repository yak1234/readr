// IPC for the live history: the "Earlier" list of a station's or channel's past sessions, and one
// session's transcript. Main window only.

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { Kysely } from "kysely";
import type { DB } from "./db";
import { isUuid } from "./json-values";
import * as history from "./live-history";
import type { LiveSession, LiveTranscript } from "../shared/live-history";

export interface LiveHistoryIpcOptions {
  /** The database once the library is ready, else null. */
  database: () => Promise<Kysely<DB> | null>;
  fromMain: (e: IpcMainInvokeEvent) => boolean;
}

/** A station is named by at most its id and its stream's address. */
const MAX_IDS = 4;
/** Longer than any station id or stream address. */
const MAX_ID_LENGTH = 2048;

export function registerLiveHistoryIpc(o: LiveHistoryIpcOptions): void {
  const mainDb = async (e: IpcMainInvokeEvent) => (o.fromMain(e) ? o.database() : null);

  ipcMain.handle("history:sessions", async (e, stationIds: unknown): Promise<LiveSession[]> => {
    const ids = Array.isArray(stationIds) ? stationIds.filter((s): s is string => typeof s === "string" && s !== "" && s.length <= MAX_ID_LENGTH).slice(0, MAX_IDS) : [];
    const db = ids.length ? await mainDb(e) : null;
    return db ? history.listSessions(db, ids) : [];
  });

  ipcMain.handle("history:transcript", async (e, sessionId: unknown): Promise<LiveTranscript | null> => {
    const db = isUuid(sessionId) ? await mainDb(e) : null;
    const session = db && (await history.getSession(db, sessionId as string));
    return db && session ? { session, sentences: await history.sessionSentences(db, session.id) } : null;
  });
}
