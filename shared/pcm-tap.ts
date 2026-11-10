// Taps a playing media element's sound as 16 kHz mono PCM for live speech
// recognition. Used by the radio player (in Readr's window). Playback itself is
// untouched.

export const ASR_RATE = 16000;
const CHUNK = 4096; // samples per chunk: 0.256 s at 16 kHz

export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.trunc(s * 32768) : Math.trunc(s * 32767);
  }
  return out;
}

/** Loudness (RMS) on a 0..1 scale, used to cut segments at pauses. */
export function level(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const s of pcm) sum += (s / 32768) ** 2;
  return Math.sqrt(sum / pcm.length);
}

export interface PcmChunk {
  pcm: Int16Array;
  level: number;
  /** The element's playback time at the start of this chunk, in seconds. */
  mediaTime: number;
}

/** Starts tapping `media`; returns a function that stops. Chunks arrive only
 * while it is playing. */
export function startPcmTap(media: HTMLMediaElement & { captureStream(): MediaStream }, onChunk: (chunk: PcmChunk) => void): () => void {
  const ctx = new AudioContext({ sampleRate: ASR_RATE });
  let source: MediaStreamAudioSourceNode | null = null;
  // ScriptProcessor rather than an AudioWorklet: a worklet needs a module URL.
  const node = ctx.createScriptProcessor(CHUNK, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // the processor must reach the output to run; keep it silent
  node.connect(mute).connect(ctx.destination);
  node.onaudioprocess = (e) => {
    if (media.paused) return;
    const pcm = floatToPcm16(e.inputBuffer.getChannelData(0));
    onChunk({ pcm, level: level(pcm), mediaTime: Math.max(0, media.currentTime - pcm.length / ASR_RATE) });
  };
  const connect = () => {
    const stream = media.captureStream();
    if (stream.getAudioTracks().length === 0) return false;
    source?.disconnect();
    source = ctx.createMediaStreamSource(stream);
    source.connect(node);
    return true;
  };
  // The stream has no audio track until the element has loaded audio.
  if (!connect()) media.addEventListener("playing", connect, { once: true });
  void ctx.resume();
  return () => {
    media.removeEventListener("playing", connect);
    source?.disconnect();
    node.disconnect();
    void ctx.close();
  };
}
