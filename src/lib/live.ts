// The live transcript's in-flight text, shared by the radio player and the
// components that draw it. The sentence being heard changes every few hundred
// ms, so it lives in a small subscribed store: only the components that draw it
// re-render. (Finished sentences are appended to the station's article by
// radio-player.ts.)

import { createStore, useStore } from "./store";

export const liveText = createStore<{ partial: string; error: string | null }>({ partial: "", error: null });

export const useLivePartial = () => useStore(liveText, (s) => s.partial);
export const useLiveError = () => useStore(liveText, (s) => s.error);

export type LiveEvent = { type: string; text?: string; message?: string };
export type LiveText = { partial: string; error: string | null };

/** How a speech event changes the live text. A final sentence closes the segment
 * whose words were the preview, so the preview clears in the same step. */
export function nextLiveText(s: LiveText, e: LiveEvent): LiveText {
  if (e.type === "partial") return { ...s, partial: e.text ?? "" };
  if (e.type === "error") return { ...s, error: e.message ?? null };
  if (e.type === "final") return { ...s, partial: "" };
  return s;
}
