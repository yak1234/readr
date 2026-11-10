// Live TV subtitles drawn over the video: one line of the original, one of its translation.

/** A finished sentence stays on screen at least this long (ms) before the words being heard replace it. */
export const SUBTITLE_HOLD_MIN = 3000;
/** ...and longer for longer sentences (ms per character), up to this much. */
const HOLD_PER_CHAR = 55;
const HOLD_MAX = 8000;

/** A final whose translation is on its way waits for it, but never longer than this (ms). */
export const SUBTITLE_WAIT_MAX = 12000;

export function subtitleHold(text: string): number {
  return Math.min(HOLD_MAX, Math.max(SUBTITLE_HOLD_MIN, text.length * HOLD_PER_CHAR));
}

/** What the original line shows: the newest finished sentence (solid) while it is
 * fresh, its translation is still coming, or nothing else is being heard;
 * otherwise the words being heard (faded). `at` is when it (or its translation) arrived. */
export function subtitleView(preview: string, last: { text: string; at: number; waiting?: boolean } | null, now: number): { text: string; final: boolean } {
  const heard = preview.trim();
  const age = last ? now - last.at : 0;
  if (last && (!heard || age < subtitleHold(last.text) || (last.waiting && age < SUBTITLE_WAIT_MAX))) return { text: last.text, final: true };
  return { text: heard, final: false };
}

/** The address a TV channel should play: its audio-only variant while nobody can see
 * the window, unless ffmpeg already decodes the stream for captions; else the full stream.
 * Visible always means the full stream, so the picture comes back after an ffmpeg takeover. */
export function dataSavingSrc(url: string, s: { visible: boolean; ffmpeg: boolean; variant: string | null }): string {
  return !s.visible && !s.ffmpeg && s.variant ? s.variant : url;
}
