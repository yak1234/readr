// A tiny subscribed store, for state that changes many times a second (live
// partial text, playback time). Components subscribe to just the slice they draw,
// so a change re-renders them and nothing above them.

import { useSyncExternalStore } from "react";

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Re-renders only when the selected slice changes (compared with Object.is). */
export function useStore<T, S>(store: Store<T>, select: (value: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

/** Dev/harness aid: when a page sets `window.__readrRenders = {}`, components that
 * call this count their renders there. Does nothing otherwise. */
export function countRender(name: string): void {
  const counts = (globalThis as { __readrRenders?: Record<string, number> }).__readrRenders;
  if (counts) counts[name] = (counts[name] ?? 0) + 1;
}
