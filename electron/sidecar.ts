// Starts and talks to the local Python translation / dictionary server.

import { app } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LookupResult, SidecarStatus } from "../shared/types";

const PORT = Number(process.env.READR_SIDECAR_PORT || 8765);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | null = null;

function sidecarDir(): string {
  // In development the folder sits next to package.json; when packaged it is
  // shipped as an extra resource.
  const dev = path.join(app.getAppPath(), "sidecar");
  if (fs.existsSync(dev)) return dev;
  return path.join(process.resourcesPath, "sidecar");
}

function pythonExecutable(dir: string): string {
  if (process.env.READR_PYTHON) return process.env.READR_PYTHON;
  const candidates = [
    path.join(dir, ".venv", "Scripts", "python.exe"), // Windows venv (uv venv / python -m venv)
    path.join(dir, ".venv", "bin", "python"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? (process.platform === "win32" ? "python" : "python3");
}

async function isUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startSidecar() {
  if (process.env.READR_NO_SIDECAR) return;
  if (await isUp()) return; // already running (e.g. started by hand)
  const dir = sidecarDir();
  const script = path.join(dir, "server.py");
  if (!fs.existsSync(script)) return;
  child = spawn(pythonExecutable(dir), [script, "--port", String(PORT)], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[sidecar] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[sidecar] ${d}`));
  child.on("error", (err) => console.error("[sidecar] could not start:", err.message));
  child.on("exit", (code) => {
    console.log(`[sidecar] exited with code ${code}`);
    child = null;
  });
}

export function stopSidecar() {
  child?.kill();
  child = null;
}

export async function sidecarStatus(): Promise<SidecarStatus> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()) as SidecarStatus;
  } catch {
    return {
      ok: false,
      translator: "",
      spacy: false,
      dictionary: false,
      message: child ? "Starting up (the first run downloads the translation model)…" : "Translation server is not running.",
    };
  }
}

export async function translate(sentences: string[]): Promise<string[]> {
  const res = await fetch(`${BASE}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentences, src: "fr", tgt: "en" }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Translator returned HTTP ${res.status}`);
  const data = (await res.json()) as { translations: string[] };
  return data.translations;
}

export async function lookup(word: string, sentence: string): Promise<LookupResult | null> {
  try {
    const res = await fetch(`${BASE}/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word, sentence, lang: "fr" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LookupResult;
  } catch {
    return null;
  }
}
