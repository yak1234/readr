// The decision model that suggests which sites' logins to import: llama.cpp's
// llama-server running LiquidAI/d1-omni-600M. It runs only while the import dialog
// is open, on a free local port, and the dialog works without it.

import { ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import { freePort } from "./ports";
import { here } from "./runtime-paths";
import { QUESTION, parseAnswer, parseHomepage, type Probs, type SiteInfo } from "../shared/site-kinds";

const MODEL = "LiquidAI/d1-omni-600M-GGUF:Q8_0";

/** llama.cpp's server, if this computer has it (READR_LLAMA_SERVER overrides the search; see runtime-paths). */
const binary = (): string | null => here().llamaServer;

export type ModelState = "none" | "loading" | "ready";

export interface ModelDeps {
  binary: () => string | null;
  freePort: () => Promise<number>;
  spawn: (bin: string, args: string[]) => ChildProcess;
  healthy: (port: number) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
}

/** The server's lifecycle. A hard crash of Electron can leave llama-server running (accepted;
 * the next dialog starts its own on a fresh port). */
export function createModel(deps: ModelDeps) {
  let proc: ChildProcess | null = null;
  let ready: Promise<number | null> | null = null;
  let state: ModelState = "none";
  let generation = 0; // bumped by stop(): every await in a start checks it

  function start(): void {
    if (ready) return;
    const bin = deps.binary();
    if (!bin) {
      ready = Promise.resolve(null);
      return;
    }
    const mine = ++generation;
    const cancelled = () => generation !== mine;
    state = "loading";
    ready = (async () => {
      const port = await deps.freePort();
      if (cancelled()) return null;
      const child = deps.spawn(bin, ["-hf", MODEL, "-b", "4096", "-ub", "4096", "--host", "127.0.0.1", "--port", String(port)]);
      proc = child;
      let exited = false;
      child.once("exit", () => {
        exited = true;
        if (proc === child) proc = null;
      });
      child.once("error", () => (exited = true));
      const deadline = Date.now() + deps.timeoutMs; // allows the first download
      while (!exited && !cancelled() && Date.now() < deadline) {
        const ok = await deps.healthy(port);
        if (cancelled()) break;
        if (ok) {
          state = "ready";
          return port;
        }
        await deps.sleep(500);
      }
      if (cancelled()) child.kill("SIGTERM");
      else state = "none";
      return null;
    })();
  }

  function stop(): void {
    generation++;
    const child = proc;
    proc = null;
    ready = null;
    state = "none";
    child?.kill("SIGTERM");
  }

  return { start, stop, port: () => ready ?? Promise.resolve(null), state: () => state };
}

const model = createModel({
  binary,
  freePort,
  spawn: (bin, args) => spawn(bin, args, { stdio: "ignore", windowsHide: true }),
  healthy: (port) => fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs: 10 * 60_000,
});

/** Start the server in the background (the first run downloads the model). Safe to call again. */
export const startModel = model.start;
export const stopModel = model.stop;
export const modelState = model.state;
export const modelAvailable = async () => (await model.port()) !== null;

export async function classifyState(state: string): Promise<Probs | null> {
  const port = await model.port();
  if (!port) return null;
  const res = await fetch(`http://127.0.0.1:${port}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state, questions: { kind: QUESTION } }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.ok ? parseAnswer(await res.json()) : null;
}

/** A site's homepage title and description, fetched without cookies. `site` must be a
 * registrable domain (callers check; see import-guard.ts). */
export async function fetchSiteInfo(site: string): Promise<SiteInfo> {
  for (const host of [`www.${site}`, site]) {
    try {
      const res = await fetch(`https://${host}/`, {
        signal: AbortSignal.timeout(4000),
        redirect: "follow",
        credentials: "omit",
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "accept-language": "en,fr;q=0.8" },
      });
      if (!res.ok) continue;
      const html = (await res.text()).slice(0, 300_000);
      const info = parseHomepage(html);
      if (info.title || info.description) return info;
    } catch {
      // try the next host
    }
  }
  return { title: "", description: "" };
}
