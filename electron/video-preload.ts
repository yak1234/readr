// Runs inside the youtube.com page shown in Readr's player view (isolated world,
// sandboxed: only ipcRenderer is available). It shrinks the page to just the
// player, reports playback to Readr, obeys its commands, draws Readr's two-line
// subtitles over the video (inside the player, so they stay in fullscreen), and
// records audio clips of single lines.

import { ipcRenderer } from "electron";
import type { VideoKey, VideoState } from "../shared/types";

const PAGE_CSS = `
  html, body { overflow: hidden !important; background: #000 !important; }
  #masthead-container, #secondary, #below, #chat, ytd-popup-container, tp-yt-app-drawer,
  ytd-mini-guide-renderer, #guide, .ytp-caption-window-container, .ytp-chrome-top,
  .ytp-pause-overlay, .ytp-endscreen-content, .ytp-ce-element { display: none !important; }
  #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2000 !important; }
  #movie_player video.html5-main-video { object-fit: contain; }
  #readr-overlay { position: absolute; left: 50%; bottom: 9%; transform: translateX(-50%); width: min(92%, 1100px);
    z-index: 70; pointer-events: none; text-align: center; font-family: -apple-system, "Helvetica Neue", sans-serif;
    text-shadow: 0 1px 3px rgba(0,0,0,.9), 0 0 8px rgba(0,0,0,.6); }
  #readr-overlay div { display: inline-block; padding: 2px 10px; border-radius: 4px; background: rgba(0,0,0,.45); }
  #readr-overlay .src { color: #fff; font-size: clamp(16px, 2.6vw, 34px); font-weight: 500; line-height: 1.3; }
  #readr-overlay .tgt { color: #f5d77a; font-size: clamp(13px, 2vw, 26px); margin-top: 4px; line-height: 1.3; font-style: italic; }
  .ytp-chrome-bottom { z-index: 80 !important; }
`;

let video: HTMLVideoElement | null = null;
let rangeEnd: number | null = null;
let recorder: MediaRecorder | null = null;
let overlay = { text: "", translation: "" };
let lastReport = 0;

const player = () => document.getElementById("movie_player");
const isAd = () => Boolean(player()?.classList.contains("ad-showing"));

function installCss() {
  if (document.getElementById("readr-css")) return;
  const style = document.createElement("style");
  style.id = "readr-css";
  style.textContent = PAGE_CSS;
  (document.head ?? document.documentElement).appendChild(style);
  // The player sizes its video from layout; let it re-measure at the new size.
  window.dispatchEvent(new Event("resize"));
}

function renderOverlay() {
  const p = player();
  if (!p) return;
  let el = document.getElementById("readr-overlay");
  if (!el) {
    // Built node by node: YouTube enforces Trusted Types, which blocks innerHTML.
    el = document.createElement("div");
    el.id = "readr-overlay";
    const src = document.createElement("div");
    src.className = "src";
    const tgt = document.createElement("div");
    tgt.className = "tgt";
    el.append(src, document.createElement("br"), tgt);
    p.appendChild(el);
  } else if (el.parentElement !== p) {
    p.appendChild(el);
  }
  const [src, , tgt] = Array.from(el.children) as HTMLElement[];
  src.textContent = overlay.text;
  src.style.display = overlay.text ? "" : "none";
  tgt.textContent = overlay.translation;
  tgt.style.display = overlay.translation ? "" : "none";
  el.style.display = isAd() ? "none" : "";
}

function report(force = false) {
  if (!video) return;
  const now = performance.now();
  if (!force && now - lastReport < 200) return;
  lastReport = now;
  const state: VideoState = { time: video.currentTime, paused: video.paused, ad: isAd(), rate: video.playbackRate };
  ipcRenderer.send("video:state", state);
}

function attach(v: HTMLVideoElement) {
  video = v;
  for (const ev of ["play", "pause", "seeked", "ratechange"]) v.addEventListener(ev, () => report(true));
  v.addEventListener("timeupdate", () => report());
}

// YouTube builds the player late and can swap the <video> element, so keep checking.
setInterval(() => {
  installCss();
  const v = document.querySelector<HTMLVideoElement>("video.html5-main-video");
  if (v && v !== video) attach(v);
  if (video && rangeEnd !== null && !isAd() && video.currentTime >= rangeEnd) {
    rangeEnd = null;
    video.pause();
    if (recorder?.state === "recording") recorder.stop();
  }
  if (video && !video.paused) report();
  renderOverlay();
}, 100);

function play() {
  video?.play().catch(() => undefined);
}

function seekTo(time: number): Promise<void> {
  return new Promise((resolve) => {
    if (!video) return resolve();
    const done = () => resolve();
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = Math.max(0, time);
    setTimeout(done, 1500); // already there, or seeking stalled
  });
}

async function recordClip(start: number, end: number) {
  if (!video) return ipcRenderer.send("video:clip", null);
  try {
    const capturable = video as HTMLVideoElement & { captureStream(): MediaStream };
    const tracks = capturable.captureStream().getAudioTracks();
    if (tracks.length === 0) throw new Error("no audio track");
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: "audio/webm;codecs=opus" });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      recorder = null;
      const bytes = new Uint8Array(await new Blob(chunks, { type: "audio/webm" }).arrayBuffer());
      ipcRenderer.send("video:clip", bytes);
    };
    video.pause();
    await seekTo(start);
    recorder = rec;
    rec.start();
    rangeEnd = end;
    play();
  } catch {
    recorder = null;
    ipcRenderer.send("video:clip", null);
  }
}

type Command =
  | { type: "seek"; time: number; play?: boolean }
  | { type: "range"; start: number; end: number }
  | { type: "toggle" }
  | { type: "pause" }
  | { type: "rate"; delta: number }
  | { type: "clip"; start: number; end: number };

ipcRenderer.on("video:cmd", async (_e, cmd: Command) => {
  if (!video) return;
  switch (cmd.type) {
    case "seek":
      rangeEnd = null;
      await seekTo(cmd.time);
      if (cmd.play) play();
      break;
    case "range":
      await seekTo(cmd.start);
      rangeEnd = cmd.end;
      play();
      break;
    case "toggle":
      rangeEnd = null;
      if (video.paused) play();
      else video.pause();
      break;
    case "pause":
      video.pause();
      break;
    case "rate":
      video.playbackRate = Math.min(2, Math.max(0.25, Math.round((video.playbackRate + cmd.delta) * 100) / 100));
      break;
    case "clip":
      if (!recorder) recordClip(cmd.start, cmd.end);
      break;
  }
});

ipcRenderer.on("video:overlay", (_e, text: string, translation: string) => {
  overlay = { text, translation };
  renderOverlay();
});

// Study keys work while the player has focus; YouTube keeps its own (space, k, arrows, f).
const KEYS: Record<string, VideoKey> = { a: "prev", d: "next", s: "repeat", "[": "slower", "]": "faster" };
window.addEventListener(
  "keydown",
  (e) => {
    const target = e.target as HTMLElement | null;
    if (e.metaKey || e.ctrlKey || e.altKey || target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
    const key = KEYS[e.key.toLowerCase()];
    if (!key) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ipcRenderer.send("video:key", key);
  },
  true,
);
