// Audio clips for flashcards made from live sentences (radio and TV). The live session's audio
// passes through a ring buffer holding the last five minutes; a card made from a finished
// sentence takes the segment it was heard in, padded and capped, and keeps it as Opus.
// Nothing else of the audio is ever stored.

import { spawn } from "node:child_process";
import { ffmpegPath } from "./ffmpeg-source";
import type { SampleSpan } from "../shared/live-transcript";

export const SAMPLE_RATE = 16000;
/** How much audio the ring keeps: five minutes. */
export const RING_SAMPLES = SAMPLE_RATE * 300;
/** Half a second of audio either side of the segment. */
export const CLIP_PAD_SAMPLES = SAMPLE_RATE / 2;
/** A clip is never longer than 12 s. */
export const CLIP_MAX_SAMPLES = SAMPLE_RATE * 12;
/** Encoding a clip this long takes well under a second; give up after this. */
const ENCODE_TIMEOUT_MS = 10_000;

/**
 * The newest `capacity` samples of a stream of 16-bit PCM. Samples are numbered from the first
 * ever pushed, and the numbers keep counting across `reset()`, which only forgets what came before.
 */
export class PcmRing {
  /** Allocated with the first audio (10 MB at the default size), freed by release(). */
  private buf: Int16Array | null = null;
  private total = 0;
  private origin = 0;

  constructor(private readonly capacity = RING_SAMPLES) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError(`capacity must be a positive integer, not ${capacity}`);
  }

  /** Whether the ring holds memory. */
  get allocated(): boolean {
    return this.buf !== null;
  }

  /** How many samples have been pushed: the number the next one will have. */
  get count(): number {
    return this.total;
  }

  /** The oldest sample still held. */
  get first(): number {
    return Math.max(this.origin, this.total - this.capacity);
  }

  push(pcm: Int16Array): void {
    const cap = this.capacity;
    const buf = (this.buf ??= new Int16Array(cap));
    // Only the newest `cap` samples of a chunk can be held.
    const keep = pcm.length > cap ? pcm.subarray(pcm.length - cap) : pcm;
    let at = (this.total + pcm.length - keep.length) % cap;
    let rest = keep;
    while (rest.length) {
      const n = Math.min(rest.length, cap - at);
      buf.set(rest.subarray(0, n), at);
      rest = rest.subarray(n);
      at = (at + n) % cap;
    }
    this.total += pcm.length;
  }

  /** A copy of samples [from, to), or null when any of them is no longer held (overwritten, or
   * before the last reset) or hasn't been heard yet. */
  slice(fromSample: number, toSample: number): Int16Array | null {
    if (!Number.isInteger(fromSample) || !Number.isInteger(toSample) || fromSample > toSample) return null;
    const buf = this.buf;
    if (!buf || fromSample < this.first || toSample > this.total) return null;
    const cap = this.capacity;
    const out = new Int16Array(toSample - fromSample);
    const start = fromSample % cap;
    const n = Math.min(out.length, cap - start);
    out.set(buf.subarray(start, start + n));
    if (n < out.length) out.set(buf.subarray(0, out.length - n), n);
    return out;
  }

  /** Forgets the audio held: the stream was interrupted (a reconnect), so its sample numbers no longer line up. */
  reset(): void {
    this.origin = this.total;
  }

  /** Forgets the audio held and frees its memory; the next push allocates it again. */
  release(): void {
    this.reset();
    this.buf = null;
  }
}

/** The samples a clip takes for a segment: half a second either side, at most 12 s (then centred on the segment). */
export function clipSpan(seg: SampleSpan): { from: number; to: number } {
  let from = seg.startSample - CLIP_PAD_SAMPLES;
  let to = seg.endSample + CLIP_PAD_SAMPLES;
  if (to - from > CLIP_MAX_SAMPLES) {
    from = Math.round((seg.startSample + seg.endSample) / 2) - CLIP_MAX_SAMPLES / 2;
    to = from + CLIP_MAX_SAMPLES;
  }
  return { from: Math.max(0, from), to };
}

/** 16 kHz mono PCM as Opus in an Ogg file, encoded by ffmpeg. */
export function encodeOpus(pcm: Int16Array, ffmpeg = ffmpegPath()): Promise<Buffer> {
  const args = ["-loglevel", "error", "-f", "s16le", "-ar", "16000", "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-b:a", "24k", "-f", "ogg", "pipe:1"];
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg took too long to encode the clip"));
    }, ENCODE_TIMEOUT_MS);
    timer.unref();
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += String(d)));
    child.stdin.on("error", () => undefined); // ffmpeg exited early: reported by "close"
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg couldn't encode the clip (${code}): ${err.trim().slice(0, 200)}`));
    });
    // s16le: Int16Array's bytes are already little-endian on every platform Electron runs on.
    child.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

/**
 * The live session's recent audio and where each finished sentence lies in it. The session pushes
 * every chunk it sends to the recogniser and remembers each saved sentence's segment; a card made
 * from a sentence asks for its clip.
 */
export class LiveClips {
  private readonly spans = new Map<string, SampleSpan>();

  constructor(private readonly ring = new PcmRing()) {}

  /** The number the next sample pushed will have. */
  get position(): number {
    return this.ring.count;
  }

  push(pcm: Int16Array): void {
    this.ring.push(pcm);
  }

  /** The sentences `ids` were heard in segment `seg`. Sentences whose audio is gone are forgotten. */
  remember(ids: string[], seg: SampleSpan): void {
    for (const [id, s] of this.spans) if (s.startSample < this.ring.first) this.spans.delete(id);
    for (const id of ids) this.spans.set(id, seg);
  }

  /** A reconnect: the audio so far no longer lines up with what comes next, so no clip can come from it. */
  reset(): void {
    this.ring.reset();
    this.spans.clear();
  }

  /** Live stopped a while ago: free the ring's memory. */
  release(): void {
    this.ring.release();
    this.spans.clear();
  }

  /** The PCM of a sentence's clip, or null when its segment's audio is no longer (or never was) held. The
   * padding is cut short where the audio held ends. */
  pcm(liveSentenceId: string): Int16Array | null {
    const seg = this.spans.get(liveSentenceId);
    if (!seg || seg.startSample < this.ring.first || seg.endSample > this.ring.count) return null;
    const { from, to } = clipSpan(seg);
    return this.ring.slice(Math.max(from, this.ring.first), Math.min(to, this.ring.count));
  }

  /** A sentence's clip as Opus (Ogg), or null when there is no audio for it or it couldn't be encoded. */
  async clip(liveSentenceId: string): Promise<Buffer | null> {
    const pcm = this.pcm(liveSentenceId);
    if (!pcm || pcm.length === 0) return null;
    try {
      return await encodeOpus(pcm);
    } catch (e) {
      console.log(`[clips] ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
