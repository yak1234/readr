#!/usr/bin/env node
// Builds runtime/: everything Readr runs with besides its own code, laid out as the packaged app expects it
// (electron/runtime-paths.ts) and movable to any folder on any Mac:
//
//   runtime/python/         a standalone CPython with every package the helpers import
//   runtime/speech/         NVIDIA's NeMo-Speech.cpp runner
//   runtime/models/hy-mt2/  the translator's weights
//   runtime/models/speech/  the voice and speech-recognition models
//   runtime/models/stanza/  word-analysis models for the core languages
//   runtime/dictionaries/   the dictionaries built so far
//   runtime/ffmpeg/         ffmpeg (radio, TV, card clips)
//
// Each step is skipped when its output is already there; --force rebuilds everything. The weights are copied
// from this computer's caches when they are there, and downloaded otherwise.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PYTHON_VERSION = "3.12";
const TRANSLATOR = "mlx-community/Hy-MT2-1.8B-8bit";
const SPEECH_MODELS = ["magpie", "nemotron-3.5"]; // magpie pulls its codec
const RUNNER_ARCHIVE = "nemo-speech-0.3.0-macos-aarch64-metal.tar.gz";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.error("This script builds the Mac runtime; the Windows one comes with the Windows plan.");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "runtime");
const force = process.argv.includes("--force");
const home = os.homedir();
const python = path.join(out, "python", "bin", "python3");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
const read = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", cwd: root, ...opts });
const has = (p) => fs.existsSync(p);
/** A copy with every link replaced by what it points to (the caches are made of links). */
const copyReal = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  run("cp", ["-RL", from, to]);
};
const bytes = (dir) => Number(read("du", ["-sk", dir]).split("\t")[0]) * 1024;

function step(name, done, build) {
  if (!force && done()) return console.log(`✓ ${name} (already there)`);
  console.log(`→ ${name}`);
  build();
  if (!done()) throw new Error(`${name}: finished, but its output is missing`);
  console.log(`✓ ${name}`);
}

if (force) fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

step("Python", () => has(python), () => {
  const staging = path.join(out, ".py");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(path.join(out, "python"), { recursive: true, force: true });
  run("uv", ["python", "install", PYTHON_VERSION, "--install-dir", staging, "--no-bin"]);
  const installed = fs.readdirSync(staging).find((n) => n.startsWith(`cpython-${PYTHON_VERSION}.`) && !fs.lstatSync(path.join(staging, n)).isSymbolicLink());
  if (!installed) throw new Error("uv installed no CPython " + PYTHON_VERSION);
  fs.renameSync(path.join(staging, installed), path.join(out, "python"));
  fs.writeFileSync(path.join(out, "python", ".installed-at"), path.join(staging, installed));
  fs.rmSync(staging, { recursive: true, force: true });
});

// Installed again whenever the lists of packages change: the stamp holds what was installed from.
const requirements = ["requirements.txt", "requirements-runtime.txt"].map((n) => fs.readFileSync(path.join(root, "sidecar", n), "utf8")).join("\n");
const wanted = crypto.createHash("sha256").update(requirements).digest("hex");
const stamp = path.join(out, "python", ".packages-installed");
step("Python packages", () => has(stamp) && fs.readFileSync(stamp, "utf8") === wanted, () => {
  run("uv", ["pip", "install", "--python", python, "--break-system-packages", "--no-cache", "-r", "sidecar/requirements-runtime.txt"]);
  const lib = path.join(out, "python", "lib", `python${PYTHON_VERSION}`);
  for (const unused of ["test", "idlelib", "tkinter", "turtledemo", "ensurepip"]) fs.rmSync(path.join(lib, unused), { recursive: true, force: true });
  fs.rmSync(path.join(out, "python", "share", "man"), { recursive: true, force: true });
  // The packages' command-line launchers hold this computer's paths and are never used (Readr runs `python -m`).
  const bin = path.join(out, "python", "bin");
  for (const name of fs.readdirSync(bin).filter((n) => !n.startsWith("python"))) fs.rmSync(path.join(bin, name), { recursive: true, force: true });
  run("find", [path.join(out, "python"), "-name", "__pycache__", "-type", "d", "-prune", "-exec", "rm", "-rf", "{}", "+"]);
  fs.writeFileSync(stamp, wanted);
});

const runner = path.join(out, "speech", "bin", "nemo-speech");
step("Speech runner", () => has(runner), () => {
  const archive = path.join(root, "sidecar", "nemo-speech", RUNNER_ARCHIVE);
  if (!has(archive)) throw new Error("Put the NeMo-Speech.cpp macOS arm64 release in sidecar/nemo-speech/ first.");
  fs.rmSync(path.join(out, "speech"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "speech"), { recursive: true });
  run("tar", ["-xzf", archive, "-C", path.join(out, "speech"), "--strip-components", "1"]);
  fs.rmSync(path.join(out, "speech", "include"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "speech", "lib", "cmake"), { recursive: true, force: true });
});

const translator = path.join(out, "models", "hy-mt2");
step("Translator weights", () => has(path.join(translator, "config.json")), () => {
  fs.rmSync(translator, { recursive: true, force: true });
  const snapshots = path.join(home, ".cache", "huggingface", "hub", `models--${TRANSLATOR.replace("/", "--")}`, "snapshots");
  const newest = has(snapshots) ? fs.readdirSync(snapshots).map((n) => path.join(snapshots, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] : null;
  if (newest) copyReal(newest, translator);
  else run(python, ["-c", "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], local_dir=sys.argv[2])", TRANSLATOR, translator]);
});

// The speech models as plain files the runner is pointed at by path (it locks and writes to a cache it is
// given by name, which a signed app can't hold): tts.gguf, codec.gguf, tokenizer/, asr.gguf.
const speech = path.join(out, "models", "speech");
const SPEECH_FILES = [
  ["magpie_tts_multilingual_357m", (n) => n.endsWith(".gguf"), "tts.gguf"],
  ["magpie_tts_multilingual_357m", (n) => n === "tokenizer", "tokenizer"],
  ["nemo-nano-codec-22khz-1.89kbps-21.5fps", (n) => n.endsWith(".gguf"), "codec.gguf"],
  ["nemotron-3.5-asr-streaming-0.6b", (n) => n.endsWith(".gguf"), "asr.gguf"],
];
step("Speech models", () => SPEECH_FILES.every(([, , name]) => has(path.join(speech, name))), () => {
  fs.rmSync(speech, { recursive: true, force: true });
  fs.mkdirSync(speech, { recursive: true });
  let cache = path.join(home, "Library", "Caches", "NeMoSpeech", "models");
  if (!has(path.join(cache, "nvidia"))) {
    cache = path.join(out, ".speech-cache");
    for (const model of SPEECH_MODELS) run(runner, ["pull", model], { env: { ...process.env, NEMO_SPEECH_MODEL_DIR: cache } });
  }
  for (const [repo, pick, name] of SPEECH_FILES) {
    const versions = path.join(cache, "nvidia", repo);
    const version = fs.readdirSync(versions).map((n) => path.join(versions, n)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
    const found = fs.readdirSync(version).find(pick);
    if (!found) throw new Error(`${repo}: no ${name} in ${version}`);
    copyReal(path.join(version, found), path.join(speech, name));
  }
  fs.rmSync(path.join(out, ".speech-cache"), { recursive: true, force: true });
});

const stanza = path.join(out, "models", "stanza");
step("Word-analysis models", () => has(path.join(stanza, "resources.json")), () => {
  const local = path.join(root, "sidecar", "models", "stanza");
  if (!has(path.join(local, "resources.json"))) throw new Error("Run Readr once from this folder first: it downloads the word-analysis models to sidecar/models/stanza.");
  fs.rmSync(stanza, { recursive: true, force: true });
  copyReal(local, stanza);
  for (const leftover of fs.readdirSync(stanza).filter((n) => n.endsWith(".lock"))) fs.rmSync(path.join(stanza, leftover));
});

// Dictionaries for the languages whose word-analysis models ship (English needs none: it is the language
// read into). One already built in sidecar/data is copied if it is complete; otherwise it is built here, by
// the helper's own code, from Wiktionary's data (a download of some minutes per language).
const DICTIONARY_LANGS = ["fr", "ar", "es", "ru", "zh"];
const dictionaries = path.join(out, "dictionaries");
const sidecar = path.join(root, "sidecar");
const complete = (file) => has(file) && read(python, ["-c", "import sys, dictionaries; from pathlib import Path; print(dictionaries.is_complete(Path(sys.argv[1])))", file], { cwd: sidecar }).trim() === "True";
step("Dictionaries", () => DICTIONARY_LANGS.every((lang) => has(path.join(dictionaries, `${lang}-en.sqlite`))), () => {
  fs.mkdirSync(dictionaries, { recursive: true });
  for (const lang of DICTIONARY_LANGS) {
    const name = `${lang}-en.sqlite`;
    const target = path.join(dictionaries, name);
    if (complete(target)) continue;
    fs.rmSync(target, { force: true });
    const local = path.join(sidecar, "data", name);
    if (complete(local)) {
      fs.copyFileSync(local, target);
      continue;
    }
    console.log(`  building the ${lang} dictionary`);
    run(python, ["-c", "import sys, dictionaries; dictionaries._job(sys.argv[1])", lang], { cwd: sidecar, env: { ...process.env, READR_DATA_DIR: dictionaries, PYTHONDONTWRITEBYTECODE: "1" } });
    if (!complete(target)) throw new Error(`The ${lang} dictionary could not be built (see the lines above).`);
  }
  for (const leftover of fs.readdirSync(dictionaries).filter((n) => !n.endsWith(".sqlite"))) fs.rmSync(path.join(dictionaries, leftover), { recursive: true, force: true });
});

// The Python remembers the folder it was installed in (in files only used to build extensions against it):
// the build tools go, and the remembered folder is made neutral.
const installedAt = path.join(out, "python", ".installed-at");
for (const name of fs.readdirSync(path.join(out, "python", "bin")).filter((n) => n.endsWith("-config"))) fs.rmSync(path.join(out, "python", "bin", name));
if (has(installedAt)) {
  const was = fs.readFileSync(installedAt, "utf8");
  let files = "";
  try {
    files = read("grep", ["-rIlF", "--include=*.py", "--include=*.pc", "--include=Makefile", was, path.join(out, "python", "lib")]);
  } catch {
    /* grep found none */
  }
  for (const file of files.split("\n").filter(Boolean)) {
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll(was, "/readr-runtime/python"));
  }
  fs.rmSync(installedAt);
}

// Some model files come read-only from their caches; an installer must be able to seal and replace them.
run("chmod", ["-R", "u+w", out]);

// ffmpeg, from the imageio-ffmpeg package (a GPL build without non-free parts, so it may be passed on; the
// ffmpeg-static package's build may not). Its one program is taken out of the package and kept at a fixed place.
const FFMPEG_PACKAGE = "imageio-ffmpeg==0.8.1";
const ffmpeg = path.join(out, "ffmpeg", "ffmpeg");
step("ffmpeg", () => has(ffmpeg) && has(path.join(out, "ffmpeg", "VERSION")) && fs.readFileSync(path.join(out, "ffmpeg", "VERSION"), "utf8").startsWith(FFMPEG_PACKAGE), () => {
  const staging = path.join(out, ".ffmpeg");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(path.join(out, "ffmpeg"), { recursive: true, force: true });
  run("uv", ["pip", "install", "--quiet", "--no-cache", "--target", staging, "--python", python, FFMPEG_PACKAGE]);
  const binaries = path.join(staging, "imageio_ffmpeg", "binaries");
  const found = fs.readdirSync(binaries).find((n) => n.startsWith("ffmpeg"));
  if (!found) throw new Error(`${FFMPEG_PACKAGE} has no ffmpeg for this computer`);
  fs.mkdirSync(path.join(out, "ffmpeg"), { recursive: true });
  fs.copyFileSync(path.join(binaries, found), ffmpeg);
  fs.chmodSync(ffmpeg, 0o755);
  const licence = read(ffmpeg, ["-L"]) + read(ffmpeg, ["-version"]);
  if (/nonfree|not legally redistributable/i.test(licence)) throw new Error("This ffmpeg build may not be redistributed; choose another.");
  if (!/enable-libopus/.test(licence)) throw new Error("This ffmpeg build has no Opus encoder (card clips need it).");
  fs.writeFileSync(path.join(out, "ffmpeg", "VERSION"), `${FFMPEG_PACKAGE}\n${found}\n${licence.split("\n")[0]}\n`);
  fs.rmSync(staging, { recursive: true, force: true });
});

const packages = Object.fromEntries(JSON.parse(read("uv", ["pip", "list", "--python", python, "--format", "json"])).map((p) => [p.name, p.version]));
const manifest = {
  python: read(python, ["-c", "import platform; print(platform.python_version())"]).trim(),
  platform: `${process.platform}-${process.arch}`,
  built: new Date().toISOString(),
  models: {
    "hy-mt2": bytes(translator),
    speech: bytes(speech),
    stanza: fs.readdirSync(stanza).filter((n) => has(path.join(stanza, n, ".readr-ready"))).sort(),
  },
  dictionaries: fs.readdirSync(dictionaries).filter((n) => n.endsWith(".sqlite")).sort(),
  packages,
};
fs.writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`✓ runtime/ is ready (${(bytes(out) / 1e9).toFixed(1)} GB)`);
