// The page's full-screen element as React state. Full screen grows the window, so a layout chosen by the room
// it has would change under it, unmount the element in full screen and so end it: layouts hold still meanwhile.

import { useState, useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};

/** The element in full screen, or null. */
export function useFullscreenElement(): Element | null {
  return useSyncExternalStore(subscribe, () => document.fullscreenElement);
}

/** `value`, except while `hold` is true: then the value it had when the hold began. */
export function useHeld<T>(value: T, hold: boolean): T {
  const [held, setHeld] = useState(value);
  if (!hold && !Object.is(held, value)) setHeld(value);
  return hold ? held : value;
}
