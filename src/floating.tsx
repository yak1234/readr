// Entry for the floating player window (index.html?floating).

import { useEffect, useState } from "react";
import type { FloatingState } from "../shared/types";
import { api } from "./lib/api";
import { FloatingPlayer } from "./components/floating-player";

export function FloatingApp() {
  const [state, setState] = useState<FloatingState | null>(null);
  useEffect(() => {
    const off = api.onFloatingState(setState);
    void api.floatingReady().then((s) => s && setState((cur) => cur ?? s));
    return off;
  }, []);
  return <FloatingPlayer state={state} />;
}
