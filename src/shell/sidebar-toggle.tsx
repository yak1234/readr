// The left panel's own icon in the title bar (with a dot while it is hidden and cards are due). ⌘\ (Ctrl\ elsewhere) does the same, except while typing.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PanelLeft } from "lucide-react";
import { toReview } from "../lib/review-counts";
import { isTypingTarget, MOD_KEY } from "./keys";
import { useStudy } from "./study-provider";
import { useReadrSettings } from "./settings-provider";

export function SidebarToggle({ color, dot }: { color: string; dot: string }) {
  const { t } = useTranslation();
  const { settings, update } = useReadrSettings();
  const { counts } = useStudy();
  const shown = !settings.sidebarHidden;
  const due = toReview(counts);
  const toggle = () => update("sidebarHidden", shown);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key !== "\\" || isTypingTarget(e.target)) return;
      e.preventDefault();
      update("sidebarHidden", shown);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, update]);

  return (
    <button
      data-sidebar-toggle
      className="readr-no-drag"
      title={t("nav.shortcut", { label: t(shown ? "nav.hidePanel" : "nav.showPanel"), key: `${MOD_KEY}\\` })}
      aria-label={t("nav.panel")}
      aria-pressed={shown}
      onClick={toggle}
      style={{ position: "relative", background: "none", border: "none", padding: 4, display: "flex", cursor: "pointer", color }}
    >
      <PanelLeft size={16} strokeWidth={1.8} />
      {!shown && due > 0 && <span data-due-dot aria-label={t("nav.reviewDue", { count: due })} style={{ position: "absolute", top: 1, right: 1, width: 7, height: 7, borderRadius: "50%", background: dot }} />}
    </button>
  );
}
