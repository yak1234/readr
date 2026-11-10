// Back and Forward, as in a browser: through the pages visited, greyed out at either end of the history.
// ⌘[ and ⌘] do the same (Ctrl elsewhere), except while typing.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { isTypingTarget } from "./keys";
import { useHistoryAvailability, useReadrNavigate } from "./navigation";

export function NavButtons({ color, disabledColor }: { color: string; disabledColor: string }) {
  const { t } = useTranslation();
  const { back, forward } = useReadrNavigate();
  const { canGoBack, canGoForward } = useHistoryAvailability();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || isTypingTarget(e.target)) return;
      if (e.key === "[" && canGoBack) back();
      else if (e.key === "]" && canGoForward) forward();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, forward, canGoBack, canGoForward]);

  const button = (label: string, data: string, enabled: boolean, onClick: () => void, Icon: typeof ChevronLeft) => (
    <button
      {...{ [data]: "" }}
      title={label}
      aria-label={label}
      disabled={!enabled}
      onClick={onClick}
      style={{ background: "none", border: "none", padding: 4, display: "flex", cursor: enabled ? "pointer" : "default", color: enabled ? color : disabledColor }}
    >
      <Icon size={16} strokeWidth={1.8} />
    </button>
  );
  return (
    <div data-nav-buttons className="readr-no-drag" style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {button(t("nav.back"), "data-nav-back", canGoBack, back, ChevronLeft)}
      {button(t("nav.forward"), "data-nav-forward", canGoForward, forward, ChevronRight)}
    </div>
  );
}
