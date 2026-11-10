// Live transcription for any live source (radio or TV, in
// Readr's window). Sources send 16 kHz PCM chunks over "live:pcm"; this cuts
// them into segments, streams them to the speech recogniser, and sends the
// window partial text and finished, timed sentences.
//
// It also wires the live history (live-history.ts: finished sentences are kept 30 days, and each
// is sent to the window with its id) to the clip buffer (clips.ts: the audio each sentence was
// heard in, so a card made from it can keep a clip).

import { BrowserWindow, ipcMain } from "electron";
import type { Kysely } from "kysely";
import { LiveSegments, cleanFinal, finalToCues, type Final } from "../shared/live-transcript";
import { runnerWs } from "./sidecar";
import { asrLocaleFor, ffmpegStreamAllowed } from "../shared/live";
import type { LiveEvent } from "../shared/types";
import { startFfmpegSource } from "./ffmpeg-source";
import { LiveClips } from "./clips";
import { LiveRecording, liveSessionStart, type LiveStation } from "./live-recording";
import type { DB } from "./db";

export type { LiveStation } from "./live-recording";

/** The audio of the current live session, from which cards made from its sentences take their clips.
 * Its memory is taken with the first audio and freed a while after live stops. */
export const liveClips = new LiveClips();
const RELEASE_AFTER_MS = 5 * 60 * 1000;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

class LiveSession {
  private ws: WebSocket | null = null;
  private open = false;
  private closed = false;
  private segments = new LiveSegments(0);
  private partial = "";
  private chunks = 0;
  private sentences = 0;
  /** Events go to the window in order, a final once its sentences are saved. */
  private sending: Promise<void> = Promise.resolve();

  constructor(
    private lang: string,
    private asr: string,
    private emit: (e: LiveEvent) => void,
    private recording: LiveRecording,
  ) {
    this.connect();
  }

  private send(event: LiveEvent | Promise<LiveEvent>) {
    this.sending = this.sending.then(async () => this.emit(await event)).catch(() => undefined);
  }

  /** Connects to the recogniser, retrying while it's still loading. Audio that
   * arrives meanwhile is dropped: a live transcript starts from "now". */
  private connect() {
    if (this.closed) return;
    this.partial = "";
    // A new connection is a new stream for the recogniser: older audio no longer lines up with it.
    liveClips.reset();
    this.segments = new LiveSegments(liveClips.position);
    const ws = new WebSocket(`${runnerWs()}/v1/audio/transcriptions/realtime`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.open = true;
      log(`connected to the recogniser (${this.lang}, ${this.asr})`);
      // Readr decides where segments end (at pauses), so the recogniser's own
      // end-of-speech detection is turned off.
      ws.send(JSON.stringify({ type: "session.update", session: { sample_rate: 16000, language: this.asr, word_timestamps: true, endpointing_ms: 600_000 } }));
    };
    // Once closed, nothing more is heard: a late final would be saved after the session ended.
    ws.onmessage = (e) => {
      if (!this.closed) this.onMessage(JSON.parse(String(e.data)));
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      this.open = false;
      if (this.closed) return;
      log("recogniser not reachable yet; retrying in 2 s");
      this.send({ type: "partial", text: "Starting speech recognition…" });
      setTimeout(() => this.connect(), 2000);
    };
    this.ws = ws;
  }

  push(pcm: Int16Array, chunkLevel: number, mediaTime: number) {
    if (this.chunks++ === 0) log(`first audio (level ${chunkLevel.toFixed(3)}, t=${mediaTime.toFixed(1)})`);
    if (!this.open || this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.segments.push(pcm.length, chunkLevel, mediaTime, liveClips.position)) {
      this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }
    // The clip buffer holds exactly what the recogniser hears, so sample numbers match segments.
    liveClips.push(pcm);
    this.ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
  }

  private onMessage(m: { type: string; delta?: string; transcript?: string; words?: Final["words"]; message?: string }) {
    if (m.type === "session.updated") {
      this.send({ type: "partial", text: "" });
    } else if (m.type === "conversation.item.input_audio_transcription.delta" && m.delta) {
      this.partial += m.delta;
      this.send({ type: "partial", text: this.partial.trim() });
    } else if (m.type === "conversation.item.input_audio_transcription.completed") {
      const f = cleanFinal({ text: m.transcript ?? "", words: m.words ?? [] });
      this.segments.final(f ?? { text: "", words: [] });
    } else if (m.type === "input_audio_buffer.committed") {
      this.partial = "";
      const done = this.segments.committed();
      if (done?.final && done.final.words.length) {
        const cues = finalToCues(done.final.words, done.start, this.lang);
        this.sentences += cues.length;
        log(`+${cues.length} sentences (${this.sentences} total, ${this.chunks} audio chunks)`);
        this.send(this.recording.save(cues, done.samples).then((saved) => ({ type: "final", cues: saved })));
      }
      this.send({ type: "partial", text: "" });
    } else if (m.type === "error") {
      log(`recogniser error: ${m.message}`);
      this.send({ type: "error", message: m.message ?? "Speech recognition error" });
    }
  }

  /** Stops listening; resolves once the sentences already heard are saved and the session has ended. */
  close(): Promise<void> {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    return this.sending.then(() => this.recording.end());
  }

  /** Translations shown for the station `stationId`: kept with this session's sentences if it is that station's. */
  translated(stationId: string, target: string, map: Record<string, string>): Promise<void> {
    return this.recording.translated(stationId, target, map);
  }
}

const log = (message: string) => console.log(`[live] ${message}`);

let session: LiveSession | null = null;
let stopFfmpeg: (() => void) | null = null;

/** Keeps translations shown for the live station `stationId` (the live article's id) with the current
 * session's sentences, when that station is the one being listened to. */
export function liveTranslated(stationId: string, target: string, map: Record<string, string>): Promise<void> {
  return session?.translated(stationId, target, map) ?? Promise.resolve();
}

/** Stops live captions. Resolves once the live history's session has ended. The clip buffer's memory
 * is freed five minutes later, unless live starts again. */
export function stopLive(): Promise<void> {
  const ended = session?.close() ?? Promise.resolve();
  session = null;
  stopFfmpeg?.();
  stopFfmpeg = null;
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => liveClips.release(), RELEASE_AFTER_MS);
  releaseTimer.unref();
  return ended;
}

const SOURCE_NAME = { page: "Readr's player", ffmpeg: "ffmpeg" };

export function registerLiveIpc(
  getWindow: () => BrowserWindow | null,
  stationFor: (url: string) => LiveStation | undefined,
  /** The library's database if it is ready right now, else null (never a wait): the live history is kept there. */
  database: () => Kysely<DB> | null,
) {
  /** `about`: the window's title and kind for the stream, naming its history when main doesn't know it. */
  ipcMain.handle("liveStart", (_e, lang: string, source: "page" | "ffmpeg", streamUrl?: string, sid?: number, about?: unknown) => {
    void stopLive();
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = null;
    // Callbacks from the socket and ffmpeg can outlive the window: never send to a destroyed one.
    const send = (event: LiveEvent) => {
      const w = getWindow();
      if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send("live:event", { ...event, sid });
    };
    if (source === "ffmpeg" && !(streamUrl && ffmpegStreamAllowed(streamUrl, stationFor))) {
      log(`refused ffmpeg for an address that is not a saved station: ${String(streamUrl).slice(0, 80)}`);
      send({ type: "error", message: "Captions aren't available for that stream." });
      return;
    }
    // `lang` is the language the user has chosen for this station (the radio panel can change it).
    const asr = asrLocaleFor({ lang });
    log(`start: ${lang}, audio from ${SOURCE_NAME[source]} (${source}), recogniser ${asr}`);
    const station = streamUrl ? stationFor(streamUrl) : undefined;
    const tell = (channel: string) => () => {
      const w = getWindow();
      if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel);
    };
    const recording = new LiveRecording(database, liveSessionStart(lang, streamUrl, station, about), liveClips, tell("activity:changed"), tell("history:changed"));
    session = new LiveSession(lang, asr, send, recording);
    if (source === "ffmpeg" && streamUrl) {
      const live = session;
      let first = true;
      stopFfmpeg = startFfmpegSource(
        streamUrl,
        (pcm, chunkLevel, t) => {
          // The renderer anchors highlighting to its player's clock at this moment.
          if (first) send({ type: "ffmpeg-audio" });
          first = false;
          live.push(pcm, chunkLevel, t);
        },
        () => {
          if (session !== live) return;
          stopFfmpeg = null;
          send({ type: "error", message: "The stream stopped." });
        },
      );
    }
  });
  ipcMain.handle("liveStop", () => stopLive());
  ipcMain.on("live:pcm", (_e, pcm: Int16Array, chunkLevel: number, mediaTime: number) => {
    session?.push(pcm instanceof Int16Array ? pcm : new Int16Array(pcm), chunkLevel, mediaTime);
  });
}
