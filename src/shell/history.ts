// Where Readr is in its history, for Back and Forward. The memory router keeps its entries to itself, so this
// follows its navigations (each entry has a stable key) and knows whether there is anything behind or ahead.

import type { DataRouter } from "react-router";
import { createStore, type Store } from "../lib/store";

export interface HistoryPosition {
  /** The entries' keys, oldest first, and the one showing. */
  keys: string[];
  index: number;
}

export type HistoryAction = "PUSH" | "REPLACE" | "POP";

/** The first entry: the memory router's starting location is keyed "default". */
export const START: HistoryPosition = { keys: ["default"], index: 0 };

export function nextPosition(p: HistoryPosition, action: HistoryAction, key: string): HistoryPosition {
  if (action === "PUSH") return { keys: [...p.keys.slice(0, p.index + 1), key], index: p.index + 1 };
  if (action === "REPLACE") return { keys: p.keys.map((k, i) => (i === p.index ? key : k)), index: p.index };
  const index = p.keys.indexOf(key);
  return index < 0 || index === p.index ? p : { keys: p.keys, index };
}

export const canGoBack = (p: HistoryPosition) => p.index > 0;
export const canGoForward = (p: HistoryPosition) => p.index < p.keys.length - 1;

/** The router's position, kept up to date as it navigates. */
export function trackHistory(router: DataRouter): Store<HistoryPosition> {
  const position = createStore<HistoryPosition>({ keys: [router.state.location.key], index: 0 });
  let shown = router.state.location.key;
  router.subscribe((state) => {
    if (state.location.key === shown) return;
    shown = state.location.key;
    position.set(nextPosition(position.get(), state.historyAction, state.location.key));
  });
  return position;
}
