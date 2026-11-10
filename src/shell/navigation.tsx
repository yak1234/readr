// Going places in Readr: typed helpers over the router (never a hand-written path), and whether Back and
// Forward have anywhere to go.

import React, { createContext, useContext, useMemo, useRef, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Store } from "../lib/store";
import { canGoBack, canGoForward, type HistoryPosition } from "./history";
import { navigator } from "./navigator";
import { pageAt, type Page } from "./routes";

export type { GoOptions, LocationState } from "./navigator";

/** The typed helpers (see navigator.ts), stable across renders. */
export function useReadrNavigate() {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location);
  here.current = location;
  return useMemo(() => navigator((to, o) => void (typeof to === "number" ? navigate(to) : navigate(to, o)), () => here.current), [navigate]);
}

/** The page showing, read from its address (null for one Readr doesn't have). */
export function usePage(): Page | null {
  const { pathname, search } = useLocation();
  return useMemo(() => pageAt(pathname + search), [pathname, search]);
}

const HistoryContext = createContext<Store<HistoryPosition> | null>(null);

/** Supplies the router's position (from trackHistory) to Back and Forward. */
export function HistoryProvider({ position, children }: { position: Store<HistoryPosition>; children: React.ReactNode }) {
  return <HistoryContext.Provider value={position}>{children}</HistoryContext.Provider>;
}

/** Whether there is a page behind and ahead in Readr's history. */
export function useHistoryAvailability(): { canGoBack: boolean; canGoForward: boolean } {
  const store = useContext(HistoryContext);
  if (!store) throw new Error("useHistoryAvailability outside HistoryProvider");
  const back = useSyncExternalStore(store.subscribe, () => canGoBack(store.get()));
  const forward = useSyncExternalStore(store.subscribe, () => canGoForward(store.get()));
  return { canGoBack: back, canGoForward: forward };
}
