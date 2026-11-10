// Where everything Readr runs with is on this computer: Python, the helper scripts, the models, the tools,
// and the folders it writes to. Packaged, all of it ships inside the app (Resources/runtime, built by
// scripts/build-runtime.mjs) and is read-only; what Readr writes goes to the user's own folders. In
// development the answers are the project's folders and the tools installed on the machine.
//
// This is the only file on the Electron side that knows the packaged layout or names a platform's paths.

import fs from "node:fs";
import path from "node:path";

/** Where the app is and what it runs on. */
export interface Where {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  userData: string;
  logs: string;
  home: string;
  platform: NodeJS.Platform;
  arch: string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
}

export interface RuntimePaths {
  /** The folder holding server.py and tts_server.py. */
  sidecarDir: string;
  /** The interpreter for server.py. */
  python: string;
  /** The interpreter for tts_server.py; null when read-aloud isn't set up. */
  ttsPython: string | null;
  /** A local folder to load Hy-MT2 from; null: by its Hugging Face name (development). */
  translatorModel: string | null;
  /** The speech models shipped as plain files (tts.gguf, codec.gguf, tokenizer/, asr.gguf); null: the runner
   * fetches them by name into its own cache (development). */
  speechModelDir: string | null;
  /** Stanza models shipped with the app (read-only). */
  bundledStanza: string | null;
  /** Stanza models downloaded on this computer. */
  userStanza: string;
  /** Dictionaries shipped with the app, copied to `dictionaries` on first run. */
  dictionarySeed: string | null;
  /** The dictionaries folder (written to). */
  dictionaries: string;
  ffmpeg: string;
  /** How to run yt-dlp. */
  ytDlp: { command: string; args: string[] };
  /** llama.cpp's server, if the computer has it (the login-import dialog's suggestions). */
  llamaServer: string | null;
  /** Where the helpers' output is kept. */
  helperLog: string;
  /** Where the bundled Python keeps its compiled files (it must not write them into the app); null: beside
   * the scripts, as Python does by itself (development). */
  pycache: string | null;
  /** Where a model downloaded later (a language the app doesn't ship) is cached by Hugging Face's library;
   * null: its default (development). */
  hfHome: string | null;
}

const HOMEBREW = ["/opt/homebrew/bin", "/usr/local/bin"];

export function runtimePaths(w: Where): RuntimePaths {
  const p = w.platform === "win32" ? path.win32 : path.posix;
  const win = w.platform === "win32";
  const first = (candidates: string[]) => candidates.find(w.exists) ?? null;
  // A packaged app takes no paths from the environment: whoever starts it chooses the environment, and the
  // programs Readr runs get Readr's own permissions (Full Disk Access, if the reader granted it).
  const vars = w.packaged ? {} : w.env;
  const env = (name: string) => vars[name] || null;

  const sidecarDir = env("READR_SIDECAR_DIR") ?? (w.packaged ? p.join(w.resourcesPath, "sidecar") : p.join(w.appPath, "sidecar"));
  const runtime = p.join(w.resourcesPath, "runtime");
  // python-build-standalone puts the interpreter at the root on Windows, in bin/ elsewhere.
  const bundledPython = win ? p.join(runtime, "python", "python.exe") : p.join(runtime, "python", "bin", "python3");
  const venvPython = (venv: string) => first([p.join(sidecarDir, venv, "Scripts", "python.exe"), p.join(sidecarDir, venv, "bin", "python")]);

  const python = env("READR_PYTHON") ?? (w.packaged ? bundledPython : (venvPython(".venv") ?? (win ? "python" : "python3")));
  const ttsPython = env("READR_TTS_PYTHON") ?? (w.packaged ? bundledPython : venvPython(".venv-tts"));

  const ytDlpOverride = env("READR_YTDLP");
  const ytDlp = ytDlpOverride
    ? { command: ytDlpOverride, args: [] }
    : w.packaged
      ? { command: bundledPython, args: ["-m", "yt_dlp"] }
      : { command: first([...HOMEBREW.map((d) => p.join(d, "yt-dlp")), p.join(w.home, ".local/bin/yt-dlp")]) ?? "yt-dlp", args: [] };

  // READR_LLAMA_SERVER, when set at all, is the only place looked in (tests set it empty to keep the model off).
  const llamaOverride = vars.READR_LLAMA_SERVER;
  const llamaServer = llamaOverride !== undefined ? first(llamaOverride ? [llamaOverride] : []) : first(HOMEBREW.map((d) => p.join(d, "llama-server")));

  return {
    sidecarDir,
    python,
    ttsPython,
    translatorModel: env("READR_TRANSLATOR_MODEL") ?? (w.packaged ? p.join(runtime, "models", "hy-mt2") : null),
    speechModelDir: env("READR_SPEECH_MODELS") ?? (w.packaged ? p.join(runtime, "models", "speech") : null),
    bundledStanza: w.packaged ? p.join(runtime, "models", "stanza") : null,
    userStanza: env("STANZA_RESOURCES_DIR") ?? (w.packaged ? p.join(w.userData, "models", "stanza") : p.join(sidecarDir, "models", "stanza")),
    dictionarySeed: w.packaged ? p.join(runtime, "dictionaries") : null,
    dictionaries: env("READR_DATA_DIR") ?? (w.packaged ? p.join(w.userData, "dictionaries") : p.join(sidecarDir, "data")),
    ffmpeg: findFfmpeg(vars, w.exists, w.packaged ? shippedFfmpeg(w.resourcesPath, w.platform) : null),
    ytDlp,
    llamaServer,
    helperLog: p.join(w.logs, "helpers.log"),
    pycache: w.packaged ? p.join(w.userData, "pycache") : null,
    hfHome: w.packaged ? p.join(w.userData, "hf") : null,
  };
}

/** The ffmpeg to run: READR_FFMPEG, else the one that ships with the app, else Homebrew's, else the PATH's. */
export function findFfmpeg(env: Record<string, string | undefined>, exists: (p: string) => boolean, shipped: string | null): string {
  return env.READR_FFMPEG || [...(shipped ? [shipped] : []), ...HOMEBREW.map((d) => `${d}/ffmpeg`)].find(exists) || "ffmpeg";
}

/** Where the packaged app keeps its ffmpeg (scripts/build-runtime.mjs puts it there). */
function shippedFfmpeg(resourcesPath: string, platform: NodeJS.Platform): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(resourcesPath, "runtime", "ffmpeg", platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

/** Whether this process is the packaged app (asked without Electron's `app`, which tests don't have). */
const packagedProcess = () => Boolean(process.versions.electron) && !(process as { defaultApp?: boolean }).defaultApp;

/** The ffmpeg for this process. It needs nothing from Electron's `app`, so tests and scripts can ask too. */
export const ffmpegHere = () => (packagedProcess() ? findFfmpeg({}, fs.existsSync, shippedFfmpeg(process.resourcesPath, process.platform)) : findFfmpeg(process.env, fs.existsSync, null));

let cached: RuntimePaths | null = null;

/** The paths for this run of the app. */
export function here(): RuntimePaths {
  if (cached) return cached;
  const { app } = require("electron") as typeof import("electron");
  cached = runtimePaths({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
    logs: app.getPath("logs"),
    home: app.getPath("home"),
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    exists: fs.existsSync,
  });
  return cached;
}

/** How to run yt-dlp in this process. READR_YTDLP answers without Electron (tests set it). */
export const ytDlpHere = (): RuntimePaths["ytDlp"] => (process.env.READR_YTDLP && !packagedProcess() ? { command: process.env.READR_YTDLP, args: [] } : here().ytDlp);

/** What the bundled Python needs in its environment: it writes nothing into the app, and loads only the
 * packages it ships with (never ones the reader installed for their own Python in ~/.local). */
export const pythonEnv = (p: RuntimePaths): Record<string, string> => (p.pycache ? { PYTHONPYCACHEPREFIX: p.pycache, PYTHONNOUSERSITE: "1" } : {});
