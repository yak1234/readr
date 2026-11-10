// Plays the selected radio station or TV channel and feeds its sound to live
// transcription. Owned by the app, not by what is on screen: opening an article
// leaves it playing. Radio and TV share this one session, so starting one stops
// the other.
//
// The <audio> (radio) or <video> (TV) element carries a PCM tap for the
// recogniser. Streams that block capture (no CORS, HLS…) are decoded by ffmpeg
// in the main process instead. The TV view shows the <video> by adopting it
// (see tvVideo); otherwise it waits, playing, in a hidden holder.

import type { Article } from "../../shared/types";
import { SOUND_LEVEL, liveEventIsCurrent, shouldFallBackToFfmpeg } from "../../shared/live";
import { startPcmTap } from "../../shared/pcm-tap";
import { cleanIpcError } from "../../shared/errors";
import { api } from "./api";
import { liveText, nextLiveText } from "./live";
import { announceRadioStart, radioStore, radioTime, radioWindow } from "./radio-session";
import { createStore } from "./store";
import { audioFocus } from "./audio-focus";
import { dataSavingSrc } from "../../shared/tv";

let audio: HTMLMediaElement | null = null;
let release: (() => void) | null = null;
let events: (() => void) | null = null;
// Set when captions come from ffmpeg instead: its clock starts at the <audio>
// element's time when its first audio arrives, so highlighting subtracts that.
// Pausing stops ffmpeg; playing starts it again, and its first audio re-anchors this.
let offset = 0;
let ffmpegFor: Article | null = null;
// Each liveStart gets a new id; events from an earlier one (a previous station) are ignored.
let sid = 0;
// A TV stream switched to its audio-only variant keeps its transcript's clock:
// the new element's time starts again, so this is added to it.
let timeBase = 0;
let corsWorks = true;

/** The TV channel's <video>, for the TV view to show (null when no channel plays). */
export const tvVideo = createStore<HTMLVideoElement | null>(null);

/** Where the <video> waits, playing, while no TV view shows it. */
export function tvHolder(): HTMLElement {
  let h = document.getElementById("readr-tv-holder");
  if (!h) {
    h = document.createElement("div");
    h.id = "readr-tv-holder";
    h.hidden = true;
    document.body.appendChild(h);
  }
  return h;
}

function detach() {
  release?.();
  release = null;
  audio = null;
  tvVideo.set(null);
}

/** Plays the stream. Streams without CORS headers won't load with crossOrigin
 * set; they're retried without it, which plays but gives the tap only silence.
 * `src` is the address actually played (a TV channel's audio-only variant while
 * the window is hidden); `base` carries the transcript clock across that switch. */
function attach(article: Article, cors: boolean, src = article.url, base = 0, autoplay = true) {
  detach();
  const video = article.kind === "tv" ? document.createElement("video") : null;
  const el = (video ?? document.createElement("audio")) as HTMLMediaElement & { captureStream(): MediaStream };
  if (video) {
    video.dataset.tvVideo = "";
    video.playsInline = true;
    if (src !== article.url) video.dataset.audioOnly = "";
  } else {
    el.hidden = true;
    el.dataset.radioAudio = "";
  }
  if (cors) el.crossOrigin = "anonymous";
  el.preload = "none";
  el.src = src;
  (video ? tvHolder() : document.body).appendChild(el);
  audio = el;
  corsWorks = cors;
  timeBase = base;
  if (base === 0) offset = 0;
  if (video) tvVideo.set(video);
  el.onplay = () => radioStore.setPlaying(true);
  el.onpause = () => el.hasAttribute("src") && radioStore.setPlaying(false);
  // An audio-only variant that won't play falls straight back to the full stream, as it was
  // playing (same CORS mode, same play state); the full stream retries without CORS, then fails.
  el.onerror = () => (src !== article.url ? attach(article, cors, article.url, base, autoplay) : cors ? attach(article, false, src, base, autoplay) : radioStore.setFailed());
  el.ontimeupdate = () => radioTime.set(Math.max(0, el.currentTime + timeBase - offset));
  if (autoplay) el.play().catch(() => radioStore.setPlaying(false));

  // Captions already come from ffmpeg (a data-saving switch after the takeover): no tap.
  if (ffmpegFor === article) {
    release = () => {
      el.onplay = el.onpause = el.onerror = el.ontimeupdate = null;
      el.pause();
      el.removeAttribute("src");
      el.load();
      el.remove();
    };
    return;
  }
  let maxLevel = 0;
  let stopTap: (() => void) | null = startPcmTap(el, (c) => {
    maxLevel = Math.max(maxLevel, c.level);
    api.livePcm(c.pcm, c.level, c.mediaTime + base);
  });
  // If the tap hears nothing through 8 s of actual playback, the stream blocks
  // capture: have the main process decode it with ffmpeg instead.
  const samples: { currentTime: number; maxLevel: number }[] = [];
  const timer = setInterval(() => {
    samples.push({ currentTime: el.currentTime, maxLevel });
    if (maxLevel > SOUND_LEVEL) return clearInterval(timer); // heard: capture works
    maxLevel = 0;
    if (!shouldFallBackToFfmpeg(samples)) return;
    clearInterval(timer);
    stopTap?.();
    stopTap = null;
    captionsViaFfmpeg(article);
  }, 1000);

  release = () => {
    clearInterval(timer);
    stopTap?.();
    el.onplay = el.onpause = el.onerror = el.ontimeupdate = null;
    // A removed <audio> keeps playing (the tap holds it): release the stream.
    el.pause();
    el.removeAttribute("src");
    el.load();
    el.remove();
  };
}

/** How the live history names a stream main doesn't know (one being tried): as the window shows it. */
const about = (article: Article) => ({ title: article.title, kind: article.kind === "tv" ? ("tv" as const) : ("radio" as const) });

/** Captions for this station come from ffmpeg in the main process. */
function captionsViaFfmpeg(article: Article) {
  ffmpegFor = article;
  void api.liveStart(article.language, "ffmpeg", article.url, ++sid, about(article));
}

// Driven by the live harness (tests/e2e), which can't provoke the real fallback.
(window as unknown as { __readrRadio?: unknown }).__readrRadio = {
  toFfmpeg: () => {
    const a = radioStore.get().article;
    if (a) captionsViaFfmpeg(a);
  },
  pause: () => pauseRadio(),
  play: () => playRadio(),
  windowVisible: (v: boolean) => setWindowVisible(v),
};

// ---------- TV data saving ----------
// While nobody can see the main window (hidden or minimised), a TV channel plays
// its audio-only variant when its master playlist has one; the picture comes back
// with the window. The switch reloads the stream at the live edge: a short gap.
let windowVisible = true;
const audioOnlyFor = new Map<string, Promise<string | null>>();

function setWindowVisible(v: boolean) {
  windowVisible = v;
  void applyDataSaving();
}
api.onWindowVisible?.(setWindowVisible);

async function applyDataSaving() {
  const article = radioStore.get().article;
  if (!article || article.kind !== "tv" || !audio) return;
  // While ffmpeg decodes the full stream for captions there's no switch to audio only (it saves
  // nothing); the switch back to the full stream always happens, so the picture returns.
  let variant: string | null = null;
  if (!windowVisible && !ffmpegFor) {
    let pending = audioOnlyFor.get(article.url);
    if (!pending) {
      // Only an answer is remembered: after a network failure the next hide asks again.
      pending = api.tvAudioOnly(article.url).catch(() => {
        audioOnlyFor.delete(article.url);
        return null;
      });
      audioOnlyFor.set(article.url, pending);
    }
    variant = await pending;
  }
  // The channel, the window or the caption source may have changed during the wait.
  const el = audio;
  if (!el || radioStore.get().article !== article) return;
  const want = dataSavingSrc(article.url, { visible: windowVisible, ffmpeg: Boolean(ffmpegFor), variant });
  if (el.getAttribute("src") === want) return;
  attach(article, corsWorks, want, el.currentTime + timeBase, !el.paused);
}

function begin(article: Article) {
  announceRadioStart();
  detach();
  events?.();
  liveText.set({ partial: "", error: null });
  radioTime.set(0);
  ffmpegFor = null;
  const mine = ++sid;
  events = api.onLiveEvent((e) => {
    if (!liveEventIsCurrent(e, sid)) return;
    // A final clears the preview in the same step the sentences arrive.
    liveText.set(nextLiveText(liveText.get(), e));
    if (e.type === "final") radioStore.addCues(e.cues, radioWindow);
    else if (e.type === "ffmpeg-audio" && audio) offset = audio.currentTime + timeBase;
  });
  attach(article, true);
  api.liveStart(article.language, "page", article.url, mine, about(article)).catch((e) => liveText.set({ ...liveText.get(), error: cleanIpcError(e) }));
  void applyDataSaving();
}

/** Selects a station or TV channel and starts it. Choosing the one already selected changes nothing. */
export function startRadio(article: Article) {
  if (radioStore.select(article)) begin(article);
}

export function playRadio() {
  if (audio?.paused) announceRadioStart();
  const resumed = audio?.paused;
  audio?.play().catch(() => radioStore.setFailed());
  if (ffmpegFor && resumed) void api.liveStart(ffmpegFor.language, "ffmpeg", ffmpegFor.url, ++sid, about(ffmpegFor));
}

export function pauseRadio() {
  audio?.pause();
  if (ffmpegFor) void api.liveStop(); // captions pause with the sound
}
audioFocus.register("radio", pauseRadio); // anything else that plays pauses the station

export function stopRadio() {
  if (!radioStore.get().article) return;
  detach();
  events?.();
  events = null;
  ffmpegFor = null;
  radioStore.stop();
  liveText.set({ partial: "", error: null });
  radioTime.set(0);
  void api.liveStop();
}
