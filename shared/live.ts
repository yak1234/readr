// Live sources: public radio streams and TV channels. A station or channel opens
// as a "live" article whose transcript is written as it plays (see live-transcript.ts).

import { languageInfo } from "./languages";
import type { Article, Lang, SavedChannel, SavedStation } from "./types";

export interface LiveChannel {
  id: string;
  name: string;
  lang: Lang;
  kind: "radio";
  url: string;
}

export const LIVE_CHANNELS: LiveChannel[] = [
  { id: "radio-franceinfo", name: "franceinfo (radio)", lang: "fr", kind: "radio", url: "https://icecast.radiofrance.fr/franceinfo-midfi.mp3" },
  { id: "radio-franceinter", name: "France Inter", lang: "fr", kind: "radio", url: "https://icecast.radiofrance.fr/franceinter-midfi.mp3" },
  { id: "radio-franceculture", name: "France Culture", lang: "fr", kind: "radio", url: "https://icecast.radiofrance.fr/franceculture-midfi.mp3" },
  { id: "radio-mcd", name: "مونت كارلو الدولية", lang: "ar", kind: "radio", url: "https://montecarlodoualiya128k.ice.infomaniak.ch/mc-doualiya.mp3" },
];

function liveBase(fields: Pick<Article, "id" | "url" | "source" | "title" | "imageUrl" | "language" | "kind">): Article {
  return {
    ...fields,
    subtitle: "", // the reader says "Live" in its own (English) words
    author: "",
    date: "",
    readingTime: 0,
    blocks: [],
    translations: {},
    progress: 0,
    savedAt: new Date().toISOString(),
    cues: [],
    live: true,
  };
}

export function radioArticle(station: SavedStation): Article {
  return liveBase({ id: station.id, url: station.url, source: "Radio", title: station.name, imageUrl: station.favicon, language: station.lang, kind: "radio" });
}

export function tvArticle(channel: SavedChannel): Article {
  return liveBase({ id: channel.id, url: channel.url, source: "Live TV", title: channel.name, imageUrl: "", language: channel.lang, kind: "tv" });
}

/** The recogniser's locale for a station: its drawer language (the user's choice). "auto" only
 * when that language has no locale: auto-detection drifts between languages mid-stream. */
export function asrLocaleFor(station: { lang: string }): string {
  return languageInfo(station.lang).asr;
}

/** A saved (or previewed) station or channel, as far as live captions need it. */
export interface LiveSource {
  url: string;
  lang: string;
}

/** ffmpeg may only open http(s) addresses that belong to a saved station or channel. */
export function ffmpegStreamAllowed(url: string, stationFor: (url: string) => LiveSource | undefined): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return stationFor(url) !== undefined;
}

/** A level above this means the page's tap hears the stream. */
export const SOUND_LEVEL = 0.001;
/** Seconds of real playback the tap may stay silent before ffmpeg takes over. */
export const SILENT_AFTER = 8;

/** Decides, from once-a-second samples of the <audio> clock and the loudest tap
 * level since the previous sample, whether the stream blocks capture. Time
 * spent buffering (clock not moving) doesn't count as playback. */
export function shouldFallBackToFfmpeg(samples: { currentTime: number; maxLevel: number }[]): boolean {
  if (samples.some((s) => s.maxLevel > SOUND_LEVEL)) return false;
  let played = 0;
  for (let i = 1; i < samples.length; i++) {
    const advance = samples[i].currentTime - samples[i - 1].currentTime;
    if (advance >= 0.5) played += Math.min(advance, 2);
  }
  return played >= SILENT_AFTER;
}

/** Only http(s) addresses are fetched or played. */
export function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

/** What stands in for a translation that hasn't arrived: nothing when none is coming. */
export function pendingMark(live: boolean, expected: boolean | undefined): "none" | "dots" | "shimmer" {
  if (expected === false) return "none";
  return live ? "dots" : "shimmer";
}

/** Live events carry the id the renderer gave liveStart; late ones from an earlier station are stale. */
export function liveEventIsCurrent(e: { sid?: number }, sid: number): boolean {
  return e.sid === sid;
}
