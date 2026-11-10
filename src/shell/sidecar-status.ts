// The translation engine's state, polled: quickly until it is up, then occasionally.

import { useEffect, useState } from "react";
import type { SidecarStatus } from "../../shared/types";
import { api } from "../lib/api";

export function useSidecarStatus(): SidecarStatus | null {
  const [status, setStatus] = useState<SidecarStatus | null>(null);
  useEffect(() => {
    let timer: number;
    const tick = async () => {
      const s = await api.sidecarStatus().catch(() => null);
      setStatus(s);
      timer = window.setTimeout(tick, s?.ok ? 30_000 : 4_000);
    };
    void tick();
    return () => window.clearTimeout(timer);
  }, []);
  return status;
}
