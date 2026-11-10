// Where one live session's finished sentences go: its session in the live history (created with the
// first sentence, so a station only tried for a moment leaves nothing) and the clip buffer, which
// remembers where each sentence's audio is. Captions never wait on this: while the library isn't
// ready, sentences go out without ids.

import type { Kysely } from "kysely";
import { withTx, type DB } from "./db";
import * as activity from "./activity";
import type { LiveClips } from "./clips";
import type { LiveSource } from "../shared/live";
import type { LiveCue, SampleSpan } from "../shared/live-transcript";
import * as history from "./live-history";

/** A saved (or previewed) station or channel, as the live history names it. */
export interface LiveStation extends LiveSource {
  id: string;
  name: string;
  kind: history.LiveKind;
}

const MAX_NAME = 200;

/**
 * How the live history names a session. A station or channel main knows by its address is named by
 * its id; any other stream by its address (main identifies streams by address, so the id is stable),
 * with the name and kind the window shows (`about`, from the renderer: checked here).
 */
export function liveSessionStart(lang: string, streamUrl: string | undefined, station: LiveStation | undefined, about: unknown): history.LiveSessionStart {
  if (station) return { kind: station.kind, stationId: station.id, stationName: station.name, lang };
  const a = typeof about === "object" && about !== null ? (about as Record<string, unknown>) : {};
  const name = typeof a.title === "string" && a.title.trim() ? a.title.trim().slice(0, MAX_NAME) : null;
  return { kind: a.kind === "tv" ? "tv" : "radio", stationId: streamUrl || null, stationName: name, lang };
}

export class LiveRecording {
  private session: Promise<string> | null = null;
  private ended = false;

  constructor(
    /** The database if the library is ready right now, else null (never a wait). */
    private readonly database: () => Kysely<DB> | null,
    private readonly start: history.LiveSessionStart,
    private readonly clips: LiveClips,
    /** The minutes listened were logged (today's activity changed). */
    private readonly onLogged: () => void = () => undefined,
    /** Its session started or ended (the Earlier lists change). */
    private readonly onSessionChanged: () => void = () => undefined,
  ) {}

  /** Saves a segment's sentences and remembers where their audio is; returns them with their ids
   * (without, when the library isn't ready or the recording has ended). */
  async save(cues: LiveCue[], samples: SampleSpan | null): Promise<LiveCue[]> {
    const db = this.ended ? null : this.database();
    if (!db) return cues;
    try {
      const ids = await history.addSentences(db, await this.sessionId(db), cues);
      if (samples) this.clips.remember(ids, samples);
      return cues.map((c, i) => ({ ...c, id: ids[i] }));
    } catch (e) {
      console.log(`[live] couldn't save sentences to the live history: ${e instanceof Error ? e.message : String(e)}`);
      return cues;
    }
  }

  private sessionId(db: Kysely<DB>): Promise<string> {
    if (!this.session) {
      this.session = history.startSession(db, this.start, new Date()).catch((e) => {
        this.session = null; // the next segment tries again
        throw e;
      });
      this.session.then(() => this.onSessionChanged(), () => undefined);
    }
    return this.session;
  }

  /** Keeps translations of this session's sentences, when they are of its own station (`stationId`, the
   * live article's id) and a session has started. */
  async translated(stationId: string, target: string, map: Record<string, string>): Promise<void> {
    if (stationId !== this.start.stationId) return;
    const id = await this.session?.catch(() => null);
    const db = id ? this.database() : null;
    if (db && id) await history.saveTranslations(db, id, target, map).catch((e) => console.log(`[live] couldn't keep translations: ${e instanceof Error ? e.message : String(e)}`));
  }

  /** Ends the session (if one was started) and logs the minutes listened. Call once every save has settled; nothing is saved afterwards. */
  async end(): Promise<void> {
    this.ended = true;
    const id = await this.session?.catch(() => null);
    const db = id ? this.database() : null;
    if (!db || !id) return;
    // The session's end and the minutes listened are written together.
    const now = new Date();
    const logged = await withTx(db, async (trx) => {
      const ms = await history.endSession(trx, id, now);
      if (ms !== null) await activity.record(trx, "listen", id, ms / 60_000, now);
      return ms !== null;
    }).catch(() => false);
    if (logged) {
      this.onLogged();
      this.onSessionChanged();
    }
  }
}
