// Live captions for streams the page can't tap (no CORS headers): ffmpeg
// decodes the stream itself to 16 kHz PCM. Playback stays in the radio player.

import { spawn } from "node:child_process";
import { ffmpegHere } from "./runtime-paths";
import fs from "node:fs";

const RATE = 16000;
const CHUNK = 4096; // samples, matching the in-page tap

export function ffmpegArgs(url: string): string[] {
  return ["-loglevel", "error", "-protocol_whitelist", "http,https,tcp,tls,crypto", "-i", url, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"];
}

/** The ffmpeg to run (the one that ships with Readr; see runtime-paths). */
export function ffmpegPath(): string {
  return ffmpegHere();
}

function rms(pcm: Int16Array): number {
  let sum = 0;
  for (const s of pcm) sum += (s / 32768) ** 2;
  return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}

/** Starts decoding `url`; `mediaTime` is seconds since start. Returns a stop function. */
export function startFfmpegSource(url: string, onChunk: (pcm: Int16Array, level: number, mediaTime: number) => void, onEnd: () => void = () => undefined): () => void {
  const child = spawn(ffmpegPath(), ffmpegArgs(url), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let pending = Buffer.alloc(0);
  let samples = 0;
  let stopped = false;
  child.stdout.on("data", (data: Buffer) => {
    pending = Buffer.concat([pending, data]);
    const bytes = CHUNK * 2;
    while (pending.length >= bytes) {
      const pcm = new Int16Array(CHUNK);
      for (let i = 0; i < CHUNK; i++) pcm[i] = pending.readInt16LE(i * 2);
      pending = pending.subarray(bytes);
      onChunk(pcm, rms(pcm), samples / RATE);
      samples += CHUNK;
    }
  });
  child.stderr.on("data", (d: Buffer) => {
    if (!stopped) console.log(`[live] ffmpeg: ${String(d).trim()}`);
  });
  // The stream dropped, or ffmpeg died or never started: say so once.
  let ended = false;
  const end = () => {
    if (ended || stopped) return;
    ended = true;
    onEnd();
  };
  child.on("error", (e) => {
    console.log(`[live] ffmpeg failed to start: ${e.message}`);
    end();
  });
  child.on("close", (code) => {
    console.log(`[live] ffmpeg exited (${code})`);
    end();
  });
  return () => {
    stopped = true;
    child.kill("SIGKILL");
  };
}
