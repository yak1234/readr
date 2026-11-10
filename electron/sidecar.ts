// Starts and talks to the local Python translation / dictionary server.

import { app } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toCodePoints, toUtf16 } from "./codepoints";
import { helperLog } from "./helper-log";
import { helperPorts, pinnedPorts, whoAnswers, type HelperPorts } from "./ports";
import { here, pythonEnv, type RuntimePaths } from "./runtime-paths";
import type { LookupResult, PhraseResult, RadioFacet, RadioQuery, SidecarStatus, Station } from "../shared/types";

let child: ChildProcess | null = null;
let ttsChild: ChildProcess | null = null;
// Known at once when the environment pins them; otherwise free ports, chosen when the helpers start.
let ports: HelperPorts = pinnedPorts(process.env);
const base = () => `http://127.0.0.1:${ports.sidecar}`;
const ttsBase = () => `http://127.0.0.1:${ports.tts}`;
/** NVIDIA's NeMo-Speech.cpp runner (voice + speech recognition), started by the voice server. */
export const runnerWs = () => `ws://127.0.0.1:${ports.runner}`;
/** Where the helpers of this run answer. */
export const helperAddresses = () => ({ sidecar: base(), tts: ttsBase(), runner: `http://127.0.0.1:${ports.runner}` });

// Why a helper will not answer in this run (it couldn't be started, or another program has its port); shown
// instead of "starting…", which would never end.
const unavailable: { sidecar?: string; tts?: string } = {};

/** A helper's output: to the terminal (development) and to the log file. */
function listen(tag: "sidecar" | "tts", proc: ChildProcess, quiet?: RegExp) {
  const log = helperLog(here().helperLog);
  proc.stdout?.on("data", (d) => {
    process.stdout.write(`[${tag}] ${d}`);
    log(tag, d);
  });
  proc.stderr?.on("data", (d) => {
    if (quiet?.test(String(d))) return;
    process.stderr.write(`[${tag}] ${d}`);
    log(tag, d);
  });
  proc.on("error", (err) => {
    // No "exit" follows a program that couldn't be run at all (none for this computer, as on Windows today).
    console.error(`[${tag}] could not start:`, err.message);
    log(tag, `could not start: ${err.message}`);
    unavailable[tag] = tag === "sidecar" ? "Translation and the dictionary aren't available on this computer yet." : "Read-aloud isn't available on this computer yet.";
    if (tag === "sidecar") child = null;
    else ttsChild = null;
  });
}

/** Whether to start a helper at `url`: not when one of Readr's already answers there (pinned ports only: one
 * started by hand), and not when another program has the port. */
async function shouldStart(tag: "sidecar" | "tts", url: string, port: number): Promise<boolean> {
  const who = await whoAnswers(url);
  if (who === "nobody") return true;
  if (who === "stranger") {
    const line = `port ${port} is used by another program`;
    console.error(`[${tag}] ${line}`);
    helperLog(here().helperLog)(tag, line);
    // Nothing of the reader's is sent to it: this helper has no address for the rest of the run.
    unavailable[tag] = `Port ${port} is used by another program.`;
    if (tag === "sidecar") ports = { ...ports, sidecar: 0 };
    else ports = { ...ports, tts: 0, runner: 0 };
  }
  return false;
}

// The helpers keep their input open on Readr and stop when it closes, so none is left behind however Readr ends.
const LIFELINE = { READR_LIFELINE: "1" };

export async function startSidecar() {
  if (process.env.READR_NO_SIDECAR) return;
  ports = await helperPorts(process.env);
  const p = here();
  void startTts(p);
  const script = path.join(p.sidecarDir, "server.py");
  if (!fs.existsSync(script) || !(await shouldStart("sidecar", base(), ports.sidecar))) return;
  child = spawn(p.python, [script, "--port", String(ports.sidecar)], {
    cwd: p.sidecarDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      ...LIFELINE,
      ...pythonEnv(p),
      STANZA_RESOURCES_DIR: p.userStanza,
      READR_BUNDLED_STANZA: p.bundledStanza ?? "",
      READR_DATA_DIR: p.dictionaries,
      READR_DICTIONARY_SEED: p.dictionarySeed ?? "",
      ...(p.translatorModel && { READR_TRANSLATOR_MODEL: p.translatorModel }),
      // A language the app doesn't ship downloads its word-analysis models through Hugging Face's library:
      // its cache goes with the reader's other data, never in the home folder.
      ...(p.hfHome && { HF_HOME: p.hfHome }),
    },
  });
  listen("sidecar", child);
  child.on("exit", (code) => {
    console.log(`[sidecar] exited with code ${code}`);
    child = null;
  });
}

/** The Magpie voice server (in development, in its own environment: sidecar/.venv-tts). */
async function startTts(p: RuntimePaths) {
  const script = path.join(p.sidecarDir, "tts_server.py");
  if (!p.ttsPython || !fs.existsSync(p.ttsPython) || !fs.existsSync(script)) {
    console.log("[tts] the voice server isn't set up; read-aloud is unavailable");
    return;
  }
  if (!(await shouldStart("tts", ttsBase(), ports.tts))) return;
  ttsChild = spawn(p.ttsPython, [script, "--port", String(ports.tts), "--runner-port", String(ports.runner)], {
    cwd: p.sidecarDir,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      ...LIFELINE,
      ...pythonEnv(p),
      // Shipped speech models are named to the runner by path (sidecar/runtime.py: speech_model_args).
      ...(p.speechModelDir ? { READR_SPEECH_MODELS: p.speechModelDir } : { HF_HOME: process.env.HF_HOME || path.join(p.sidecarDir, "models", "hf") }),
    },
  });
  listen("tts", ttsChild, /NeMo W|Warning|warn\(/);
  ttsChild.on("exit", (code) => {
    console.log(`[tts] exited with code ${code}`);
    ttsChild = null;
  });
}

export function stopSidecar() {
  child?.kill();
  child = null;
  ttsChild?.kill();
  ttsChild = null;
}

export interface TtsStatus {
  ready: boolean;
  voices: string[];
  message: string;
}

export async function ttsStatus(): Promise<TtsStatus> {
  try {
    const [voices, health] = await Promise.all([
      fetch(`${ttsBase()}/voices`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()),
      fetch(`${ttsBase()}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()),
    ]);
    return { ready: Boolean(voices.ready), voices: voices.voices ?? [], message: health.message ?? "" };
  } catch {
    return { ready: false, voices: [], message: unavailable.tts ?? (ttsChild ? "Starting the Magpie voice…" : "The voice server isn't running.") };
  }
}

/** WAV bytes for `text`, cached on disk so replays are instant. */
export async function speak(text: string, lang: string, voice: string, quality: "fast" | "best"): Promise<Uint8Array> {
  const dir = path.join(app.getPath("userData"), "tts-cache");
  const key = crypto.createHash("sha1").update(JSON.stringify([text, lang, voice, quality])).digest("hex");
  const file = path.join(dir, `${key}.wav`);
  if (fs.existsSync(file)) return new Uint8Array(fs.readFileSync(file));
  const res = await fetch(`${ttsBase()}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, lang, voice, quality }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => {
    throw new Error(ttsChild ? "The voice is still loading…" : "The voice server isn't running.");
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? `Voice server returned HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, bytes);
  return bytes;
}

export async function sidecarStatus(): Promise<SidecarStatus> {
  try {
    const res = await fetch(`${base()}/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()) as SidecarStatus;
  } catch {
    return {
      ok: false,
      translator: "",
      stanza: false,
      dictionary: false,
      message: unavailable.sidecar ?? (child ? "Starting up…" : "Translation server is not running."),
    };
  }
}

/** Hy-MT2's translations of `sentences`, each with its `context` (the sentences before it). With
 * `cache: false` the server translates them in that context every time and keeps nothing. */
export async function translate(sentences: string[], src: string, tgt: string, context: string[][] = [], o: { cache?: boolean } = {}): Promise<string[]> {
  const res = await fetch(`${base()}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentences, src, tgt, context, ...(o.cache === false && { cache: false }) }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {}
    throw new Error(detail || `Translator returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { translations: string[] };
  return data.translations;
}

async function getJson<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${base()}${pathAndQuery}`, { signal: AbortSignal.timeout(20_000) }).catch(() => {
    throw new Error("The Readr server isn't running.");
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {}
    throw new Error(detail || `Radio server returned HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function radioSearch(q: RadioQuery): Promise<Station[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  return getJson<Station[]>(`/radio/search?${params}`);
}

export const radioCountries = () => getJson<RadioFacet[]>("/radio/countries");
export const radioLanguages = () => getJson<RadioFacet[]>("/radio/languages");

/** Ask the server to fetch the dictionary for `lang`; never throws. */
export async function ensureDictionary(lang: string): Promise<void> {
  try {
    await fetch(`${base()}/dictionaries/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    /* the dictionary is optional */
  }
}

/** Ask the server to load `lang`'s word-analysis models now; never throws, never downloads. */
export async function warmAnalysis(lang: string): Promise<void> {
  try {
    await fetch(`${base()}/analysis/warm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* an optimisation only */
  }
}

export async function lookup(word: string, sentence: string, lang: string, tgt: string, offset?: number): Promise<LookupResult | null> {
  try {
    const res = await fetch(`${base()}/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word, sentence, lang, tgt, offset }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LookupResult;
  } catch {
    return null;
  }
}

/** Snap the selection [start, end) of `sentence` to the longest dictionary phrase containing it; null when the sidecar can't answer. */
export async function phrase(lang: string, sentence: string, start: number, end: number, timeoutMs = 20_000): Promise<PhraseResult | null> {
  try {
    const res = await fetch(`${base()}/phrase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang, sentence, start: toCodePoints(sentence, start), end: toCodePoints(sentence, end) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const r = (await res.json()) as PhraseResult;
    return { ...r, start: toUtf16(sentence, r.start), end: toUtf16(sentence, r.end) };
  } catch {
    return null;
  }
}
