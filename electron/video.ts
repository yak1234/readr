// YouTube videos as Readr articles.
//
// Adding a video: yt-dlp reads the video's details and caption links; the
// captions (YouTube's word-timed "json3" format) become timed sentences, which
// are stored as an ordinary Article so translation, lookup and vocabulary work
// unchanged.
//
// Playing a video: the real youtube.com watch page runs in a WebContentsView laid
// over a placeholder in the main window. video-preload.ts, inside that page,
// reports the playback time, takes commands, draws the subtitle overlay and
// records audio clips.

import { app, BrowserWindow, ipcMain, Session, WebContentsView } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Article, Block, Bounds, ExtractResult, Lang, VideoKey, VideoState } from "../shared/types";
import { parseJson3, wordsToCues, type Cue } from "../shared/captions";
import { mediaDir } from "./store";

// ---------------------------------------------------------------- adding a video

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host !== "youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export const videoArticleId = (videoId: string) => `yt-${videoId}`;

/** yt-dlp from Homebrew or PATH. Apps opened from the Finder don't get the
 * shell's PATH, so the usual install locations are checked first. */
export function ytDlp(): string {
  if (process.env.READR_YTDLP) return process.env.READR_YTDLP;
  const candidates = ["/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", path.join(app.getPath("home"), ".local/bin/yt-dlp")];
  return candidates.find((p) => fs.existsSync(p)) ?? "yt-dlp";
}

interface CaptionTrack {
  ext: string;
  url: string;
}

interface VideoInfo {
  id: string;
  title: string;
  description?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string;
  duration?: number;
  language?: string;
  thumbnail?: string;
  subtitles?: Record<string, CaptionTrack[]>;
  automatic_captions?: Record<string, CaptionTrack[]>;
}

function videoInfo(url: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      ytDlp(),
      ["-J", "--skip-download", "--no-playlist", "--no-warnings", url],
      { maxBuffer: 64 * 1024 * 1024, timeout: 90_000 },
      (err, stdout, stderr) => {
        if (err) {
          const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
          const line = stderr.split("\n").find((l) => l.startsWith("ERROR")) ?? err.message;
          reject(new Error(missing ? "yt-dlp isn't installed. Install it with: brew install yt-dlp" : line.replace(/^ERROR:\s*/, "")));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as VideoInfo);
        } catch {
          reject(new Error("yt-dlp returned something unexpected."));
        }
      },
    );
  });
}

/** Captions in the video's own language: human-made first, then YouTube's
 * speech recognition ("-orig" is the untranslated track). */
function pickCaptions(info: VideoInfo, lang: string): { url: string; auto: boolean } | null {
  const json3 = (tracks?: CaptionTrack[]) => tracks?.find((t) => t.ext === "json3")?.url;
  const manual = info.subtitles ?? {};
  const auto = info.automatic_captions ?? {};
  const manualKey = Object.keys(manual).find((k) => k === lang || k.startsWith(`${lang}-`));
  if (manualKey && json3(manual[manualKey])) return { url: json3(manual[manualKey])!, auto: false };
  for (const key of [`${lang}-orig`, lang]) {
    const url = json3(auto[key]);
    if (url) return { url, auto: true };
  }
  return null;
}

/** Group sentences into paragraphs at pauses, so the transcript reads like text. */
function toBlocks(cues: Cue[]): { blocks: Block[]; times: [number, number][][] } {
  const blocks: Block[] = [];
  const times: [number, number][][] = [];
  cues.forEach((cue, i) => {
    const prev = cues[i - 1];
    const current = blocks[blocks.length - 1];
    const newParagraph = !prev || cue.start - prev.end > 2 || current.sentences.length >= 5;
    if (newParagraph) {
      blocks.push({ type: "p", sentences: [] });
      times.push([]);
    }
    blocks[blocks.length - 1].sentences.push(cue.text);
    times[times.length - 1].push([cue.start, cue.end]);
  });
  return { blocks, times };
}

function formatDate(yyyymmdd?: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "";
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}T12:00:00`);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export async function extractVideo(url: string, session: Session): Promise<ExtractResult> {
  const id = youtubeId(url);
  if (!id) return { ok: false, error: "That isn't a YouTube video link." };
  try {
    const info = await videoInfo(`https://www.youtube.com/watch?v=${id}`);
    const lang: Lang = info.language === "en" || info.language === "ar" ? info.language : "fr";
    const track = pickCaptions(info, info.language || lang);
    if (!track) return { ok: false, error: "This video has no captions in its own language yet." };

    const res = await session.fetch(track.url);
    if (!res.ok) return { ok: false, error: `YouTube refused the captions (HTTP ${res.status}). Try again in a minute.` };
    const cues = wordsToCues(parseJson3(await res.json()), lang);
    if (cues.length === 0) return { ok: false, error: "The captions for this video are empty." };

    const { blocks, times } = toBlocks(cues);
    const minutes = Math.max(1, Math.round((info.duration ?? cues[cues.length - 1].end) / 60));
    const article: Article = {
      id: videoArticleId(id),
      url: `https://www.youtube.com/watch?v=${id}`,
      source: info.channel || info.uploader || "YouTube",
      title: info.title,
      subtitle: track.auto ? "Sous-titres automatiques" : "",
      author: "",
      date: formatDate(info.upload_date),
      readingTime: minutes,
      imageUrl: info.thumbnail ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      language: lang,
      blocks,
      translations: {},
      progress: 0,
      savedAt: new Date().toISOString(),
      kind: "video",
      videoId: id,
      cues: times,
    };
    return { ok: true, article };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- the player

let view: WebContentsView | null = null;
let currentId: string | null = null;
let host: BrowserWindow | null = null;
let pendingClip: { resolve: (bytes: Buffer | null) => void } | null = null;

function send(channel: string, ...args: unknown[]) {
  view?.webContents.send(channel, ...args);
}

function ensureView(session: Session): WebContentsView {
  if (view && !view.webContents.isDestroyed()) return view;
  view = new WebContentsView({
    webPreferences: {
      session,
      preload: path.join(__dirname, "video-preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  view.setBackgroundColor("#000000");
  view.setBorderRadius(8); // matches the frame it sits on in Readr's layout
  // Links and pop-ups from the YouTube page don't navigate the player away.
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (e, url) => {
    const id = youtubeId(url);
    if (!id || id !== currentId) e.preventDefault();
  });
  return view;
}

function setBounds(b: Bounds) {
  view?.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
}

export function registerVideoIpc(getWindow: () => BrowserWindow | null, session: () => Session) {
  ipcMain.handle("videoShow", async (_e, videoId: string, bounds: Bounds) => {
    const win = getWindow();
    if (!win || !/^[\w-]{11}$/.test(videoId)) return;
    const v = ensureView(session());
    if (host !== win) {
      win.contentView.addChildView(v);
      host = win;
    }
    v.setVisible(true);
    setBounds(bounds);
    if (currentId !== videoId) {
      currentId = videoId;
      await v.webContents.loadURL(`https://www.youtube.com/watch?v=${videoId}`).catch(() => undefined);
    }
  });
  ipcMain.on("videoBounds", (_e, bounds: Bounds) => setBounds(bounds));
  ipcMain.on("videoHide", () => {
    if (!view) return;
    send("video:cmd", { type: "pause" });
    view.setVisible(false);
  });
  ipcMain.on("videoSeek", (_e, time: number, play?: boolean) => send("video:cmd", { type: "seek", time, play }));
  ipcMain.on("videoPlayRange", (_e, start: number, end: number) => send("video:cmd", { type: "range", start, end }));
  ipcMain.on("videoToggle", () => send("video:cmd", { type: "toggle" }));
  ipcMain.on("videoRate", (_e, delta: number) => send("video:cmd", { type: "rate", delta }));
  ipcMain.on("videoOverlay", (_e, text: string, translation: string) => send("video:overlay", text, translation));

  // From the player page, forwarded to the Readr window.
  ipcMain.on("video:state", (e, state: VideoState) => {
    if (view && e.sender === view.webContents) getWindow()?.webContents.send("video:state", state);
  });
  ipcMain.on("video:key", (e, key: VideoKey) => {
    if (view && e.sender === view.webContents) getWindow()?.webContents.send("video:key", key);
  });
  ipcMain.on("video:clip", (e, bytes: Uint8Array | null) => {
    if (!view || e.sender !== view.webContents || !pendingClip) return;
    pendingClip.resolve(bytes ? Buffer.from(bytes) : null);
    pendingClip = null;
  });

  ipcMain.handle("videoCapture", async (_e, start: number, end: number) => capture(start, end));
}

/** Screenshot of the line's first frame and a recording of its audio. The line
 * plays once while recording, since the page can only record what it plays. */
async function capture(start: number, end: number): Promise<{ image: string; audio: string } | null> {
  if (!view || !currentId || pendingClip) return null;
  const base = `${currentId}-${Math.round(start * 1000)}`;
  const dir = mediaDir();

  const clip = new Promise<Buffer | null>((resolve) => {
    pendingClip = { resolve };
    setTimeout(() => {
      if (pendingClip?.resolve === resolve) {
        pendingClip = null;
        resolve(null);
      }
    }, (end - start) * 1000 + 15_000);
  });
  send("video:cmd", { type: "clip", start, end });

  // Give the seek a moment to land on a frame before the screenshot.
  await new Promise((r) => setTimeout(r, 700));
  const rect = await view.webContents
    .executeJavaScript(
      `(() => { const v = document.querySelector("video.html5-main-video"); if (!v) return null; const r = v.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    )
    .catch(() => null);
  let image = "";
  if (rect && rect.width > 0) {
    const shot = await view.webContents.capturePage({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    if (!shot.isEmpty()) {
      image = `${base}.jpg`;
      fs.writeFileSync(path.join(dir, image), shot.toJPEG(85));
    }
  }

  const bytes = await clip;
  let audio = "";
  if (bytes && bytes.length > 0) {
    audio = `${base}.webm`;
    fs.writeFileSync(path.join(dir, audio), bytes);
  }
  return image || audio ? { image, audio } : null;
}
