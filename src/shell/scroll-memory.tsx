// Scroll positions per history entry, for the main column (which scrolls itself, so the router's
// window-based ScrollRestoration doesn't apply). Going Back or Forward to a page puts it where it was left;
// arriving anywhere new starts it at the top, or wherever the page says (an article at its reading progress).

import React, { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

interface Memory {
  main: React.RefObject<HTMLElement | null>;
  positions: Map<string, number>;
}

const MemoryContext = createContext<Memory | null>(null);

/** Remembers `main`'s scroll position under the history entry showing. */
export function ScrollMemory({ main, children }: { main: React.RefObject<HTMLElement | null>; children: React.ReactNode }) {
  const positions = useRef(new Map<string, number>()).current;
  const { key } = useLocation();
  const shown = useRef(key);
  shown.current = key;
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const save = () => positions.set(shown.current, el.scrollTop);
    el.addEventListener("scroll", save, { passive: true });
    return () => el.removeEventListener("scroll", save);
  }, [main, positions]);
  const memory = useRef<Memory>({ main, positions }).current;
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>;
}

/** Called by a page: once `ready` (its content laid out), it is scrolled where it was left when Back or
 * Forward brought it here; otherwise `arrive` places it (the top by default). Once per visit. */
export function useScrollRestore(ready: boolean, arrive?: (main: HTMLElement) => void) {
  const memory = useContext(MemoryContext);
  const { key } = useLocation();
  const type = useNavigationType();
  // Where this entry was left, read as it renders: the scroll events of the switch (the old page's height
  // clamping the new one's) come after, and must not count.
  const left = useRef<{ key: string; top: number | undefined } | null>(null);
  if (left.current?.key !== key) left.current = { key, top: memory?.positions.get(key) };
  const done = useRef<string | null>(null);
  const arriveRef = useRef(arrive);
  arriveRef.current = arrive;
  useLayoutEffect(() => {
    const el = memory?.main.current;
    if (!ready || !el || done.current === key) return;
    done.current = key;
    const saved = left.current?.top;
    if (type === "POP" && saved !== undefined) el.scrollTop = saved;
    else if (arriveRef.current) arriveRef.current(el);
    else el.scrollTop = 0;
  }, [ready, key, type, memory]);
}

/** The main column, which scrolls (for a page that follows its own reading position). */
export function useMain(): React.RefObject<HTMLElement | null> {
  const memory = useContext(MemoryContext);
  if (!memory) throw new Error("useMain outside ScrollMemory");
  return memory.main;
}
