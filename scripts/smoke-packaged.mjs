#!/usr/bin/env node
// Proves the packaged app works on a computer that has nothing: runs Readr.app with an empty home folder, no
// Homebrew on the PATH and its own empty data folder, hidden, then asks its helpers to translate, look a word
// up, snap a phrase and speak. It also checks the app wrote nothing into its own bundle and downloaded no
// model. Usage: node scripts/smoke-packaged.mjs path/to/Readr.app

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const appPath = path.resolve(process.argv[2] ?? "release/mac-arm64/Readr.app");
const binary = path.join(appPath, "Contents", "MacOS", "Readr");
if (!fs.existsSync(binary)) {
  console.error(`SMOKE_FAILED no app at ${appPath}`);
  process.exit(1);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "readr-smoke-"));
const home = path.join(temp, "home");
const userData = path.join(temp, "user-data");
fs.mkdirSync(home);
const marker = path.join(temp, "started");
fs.writeFileSync(marker, "");
await new Promise((r) => setTimeout(r, 1100)); // file times are compared to the marker's

const child = spawn(binary, [], {
  env: { HOME: home, PATH: "/usr/bin:/bin", TMPDIR: os.tmpdir(), READR_HIDDEN: "1", READR_USER_DATA: userData, READR_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const collect = (d) => (output += d);
child.stdout.on("data", collect);
child.stderr.on("data", collect);

const SENTENCE = "Les archives sont ouvertes au public.";
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : `: ${detail}`}`);
};
const until = async (what, ms, probe) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Readr exited (code ${child.exitCode}) while waiting for ${what}`);
    const value = await probe().catch(() => null);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
const newerThanMarker = (dir) => {
  const since = fs.statSync(marker).mtimeMs;
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p);
      else if (fs.statSync(p).mtimeMs > since) found.push(p);
    }
  };
  walk(dir);
  return found;
};

let failure = "";
try {
  const where = await until("the helpers to start", 60_000, async () => {
    const line = output.split("\n").find((l) => l.startsWith("SMOKE "));
    return line ? JSON.parse(line.slice(6)) : null;
  });
  console.log(`helpers: ${where.sidecar} ${where.tts}`);

  const health = await until("the translator", 240_000, async () => {
    const h = await (await fetch(`${where.sidecar}/health`)).json();
    if (h.message && /No translation engine/.test(h.message)) throw Object.assign(new Error(h.message), { fatal: true });
    return h.ok ? h : null;
  });
  check("the dictionary and translation helper is Readr's own", health.app === "readr");
  check("word analysis is installed", health.stanza === true);

  const translated = await (await post(`${where.sidecar}/translate`, { sentences: [SENTENCE], src: "fr", tgt: "en" })).json();
  check("translation", /archives?/i.test(translated.translations?.[0] ?? ""), JSON.stringify(translated).slice(0, 200));

  const looked = await (await post(`${where.sidecar}/lookup`, { word: "archives", sentence: SENTENCE, lang: "fr", tgt: "en" })).json();
  check("dictionary lookup", looked.senses?.length > 0 && looked.lemma === "archive", JSON.stringify(looked).slice(0, 200));

  const phrase = await (await post(`${where.sidecar}/phrase`, { lang: "fr", sentence: SENTENCE, start: 5, end: 20 })).json();
  check("phrase selection takes whole words", SENTENCE.slice(phrase.start, phrase.end) === "archives sont ouvertes" && phrase.ready === true, JSON.stringify(phrase));

  const stations = await fetch(`${where.sidecar}/radio/search?language=french&limit=3`, { signal: AbortSignal.timeout(30_000) }).then((r) => r.status, () => 0);
  check("radio directory answers", stations === 200, `HTTP ${stations}`);

  await until("the voice", 300_000, async () => {
    const h = await (await fetch(`${where.tts}/health`)).json();
    if (/couldn't load|isn't available/.test(h.message ?? "")) throw new Error(h.message);
    return h.ok ? h : null;
  });
  const spoken = await post(`${where.tts}/speak`, { text: "Bonjour tout le monde.", lang: "fr" });
  const wav = Buffer.from(await spoken.arrayBuffer());
  check("read-aloud", spoken.ok && wav.subarray(0, 4).toString() === "RIFF" && wav.length > 10_000, `HTTP ${spoken.status}, ${wav.length} bytes`);

  // The app's own ffmpeg (radio, TV, card clips), run as the app runs it: a second of silence into Ogg Opus.
  const ffmpeg = path.join(appPath, "Contents", "Resources", "runtime", "ffmpeg", "ffmpeg");
  const clip = spawnSync(ffmpeg, ["-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", "-c:a", "libopus", "-f", "ogg", "-"], { env: { HOME: home, PATH: "/usr/bin:/bin" }, maxBuffer: 1 << 24 });
  check("the app's ffmpeg encodes a clip", clip.status === 0 && clip.stdout.subarray(0, 4).toString() === "OggS", String(clip.stderr || clip.error || "").slice(0, 200));
  const licence = spawnSync(ffmpeg, ["-L"], { encoding: "utf8" }).stdout ?? "";
  check("the app's ffmpeg may be redistributed", licence.length > 0 && !/nonfree|not legally redistributable/i.test(licence));

  check("dictionaries were copied to the data folder", fs.existsSync(path.join(userData, "dictionaries", "fr-en.sqlite")));
  check("the helpers' log is in the logs folder", fs.existsSync(path.join(userData, "logs", "helpers.log")));
  check("no model was downloaded to the home folder", !fs.existsSync(path.join(home, ".cache")) && !fs.existsSync(path.join(home, "Library", "Caches", "NeMoSpeech")));
  const written = newerThanMarker(appPath);
  check("nothing was written into the app", written.length === 0, written.slice(0, 5).join(", "));
} catch (err) {
  failure = err.message;
}

// Readr ends the hard way (a crash, a force-quit): every helper must still stop, the speech runner included.
child.kill("SIGKILL");
await new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once("exit", r)));
const where = JSON.parse(output.split("\n").find((l) => l.startsWith("SMOKE "))?.slice(6) ?? "{}");
const answers = (base) => fetch(base + (base === where.runner ? "/ready" : "/health"), { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
let alive = Object.keys(where);
for (let i = 0; i < 10 && alive.length; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  alive = (await Promise.all(Object.entries(where).map(async ([name, base]) => ((await answers(base)) ? name : null)))).filter(Boolean);
}
check("every helper stopped when Readr was killed", alive.length === 0, `still answering: ${alive.join(", ")}`);

const failed = checks.filter((c) => !c.ok).map((c) => c.name);
if (failure || failed.length) {
  console.log(`SMOKE_FAILED ${failure || failed.join("; ")}`);
  console.log("--- last output from Readr ---\n" + output.split("\n").slice(-25).join("\n"));
  const log = path.join(userData, "logs", "helpers.log");
  if (fs.existsSync(log)) console.log("--- helpers.log ---\n" + fs.readFileSync(log, "utf8").split("\n").slice(-25).join("\n"));
  process.exitCode = 1;
} else {
  console.log("SMOKE_OK");
  fs.rmSync(temp, { recursive: true, force: true });
}
