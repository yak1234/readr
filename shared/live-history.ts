// The live history as the renderer sees it: past listenings of a station or channel, and what was
// said in them (kept 30 days; see electron/live-history.ts).

export type LiveKind = "radio" | "tv";

/** One listening of a station or channel. */
export interface LiveSession {
  id: string;
  kind: LiveKind;
  /** The saved station's or channel's id, or the stream's address for one that wasn't saved. */
  stationId: string | null;
  stationName: string | null;
  lang: string;
  startedAt: number;
  /** Null while it is still being listened to. */
  endedAt: number | null;
  /** The language its sentences' stored translations are in; null when none are kept. */
  target: string | null;
}

/** A finished sentence of a session's transcript. */
export interface LiveSentence {
  id: string;
  /** Seconds from the start of the stream. */
  t: number;
  text: string;
  translation: string | null;
}

export interface LiveTranscript {
  session: LiveSession;
  sentences: LiveSentence[];
}
