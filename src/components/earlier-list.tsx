// "Earlier": a station's or channel's past sessions (kept 30 days), grouped Today / Yesterday / by
// date. Each opens its transcript, read-only. EarlierList is the list (the settings panel shows it);
// EarlierToggle opens it from the station's own view, the transcript header or under the TV picture.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LiveSession } from "../../shared/live-history";
import { api } from "../lib/api";
import { earlierGroups, sessionTimes } from "../lib/past-transcript";
import type { ChromeTokens } from "../lib/theme";
import { SectionLabel } from "./ui";

interface Props {
  c: ChromeTokens;
  /** What the history names the station by: its id, and its stream's address. */
  stationIds: string[];
  /** The past transcript being read, if any (marked in the list). */
  currentSessionId?: string;
  onOpen: (session: LiveSession) => void;
}

/** The list shows this many sessions until "Show all". */
const FIRST = 8;

export function EarlierList({ c, stationIds, currentSessionId, onOpen }: Props) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<LiveSession[] | null>(null);
  const [all, setAll] = useState(false);
  const key = stationIds.join("\n");
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    api.liveSessions(key.split("\n").filter(Boolean)).then(
      (s) => n === latest.current && setSessions(s),
      () => n === latest.current && setSessions([]),
    );
  }, [key]);
  useEffect(() => {
    load();
    return () => void ++latest.current; // a late answer for this station is dropped
  }, [load]);
  // A session starting or ending (and the minutes it logs) changes the list.
  useEffect(() => api.onHistoryChanged(load), [load]);
  useEffect(() => api.onActivityChanged(load), [load]);
  if (!sessions) return null;
  const groups = earlierGroups(all ? sessions : sessions.slice(0, FIRST), new Date());

  return (
    <div data-earlier>
      <SectionLabel c={c}>{t("earlier.title")}</SectionLabel>
      {sessions.length === 0 ? (
        <div data-earlier-empty style={{ fontSize: 11, color: c.muted, lineHeight: 1.5 }}>{t("earlier.empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((g) => (
            <div key={g.label} data-earlier-day={g.label}>
              <div style={{ fontSize: 10, color: c.muted, marginBottom: 2 }}>{g.label}</div>
              {g.sessions.map((s) => {
                const current = s.id === currentSessionId;
                return (
                  <button
                    key={s.id}
                    data-earlier-session={s.id}
                    data-current={current ? "" : undefined}
                    onClick={() => onOpen(s)}
                    className="readr-hover"
                    aria-current={current ? "page" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "4px 6px", margin: "0 -6px", boxSizing: "content-box", border: "none", borderRadius: 5, background: current ? c.selected : "transparent", color: c.text, fontSize: 12, fontWeight: current ? 500 : 400, fontVariantNumeric: "tabular-nums", cursor: "pointer", fontFamily: "inherit", textAlign: "left", ["--hover" as string]: c.hover }}
                  >
                    <History size={11} strokeWidth={1.8} style={{ color: c.muted, flexShrink: 0 }} />
                    {sessionTimes(s)}
                  </button>
                );
              })}
            </div>
          ))}
          {!all && sessions.length > FIRST && (
            <button data-earlier-all onClick={() => setAll(true)} style={{ alignSelf: "flex-start", background: "none", border: "none", padding: 0, fontSize: 11, color: c.muted, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
              {t("earlier.showAll", { count: sessions.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Earlier" as a button in the station's own view, opening the list beneath it. */
export function EarlierToggle({ c, onOpen, ...list }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} data-earlier-control style={{ position: "relative" }}>
      <HeaderButton c={c} data="earlier-toggle" expanded={open} onClick={() => setOpen((o) => !o)}>
        <History size={12} strokeWidth={1.8} />
        {t("earlier.title")}
        <ChevronDown size={12} strokeWidth={1.8} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </HeaderButton>
      {open && (
        <div
          data-earlier-popover
          className="readr-arrive"
          style={{ position: "absolute", top: "calc(100% + 6px)", insetInlineStart: 0, zIndex: 30, width: 240, maxHeight: 380, overflowY: "auto", padding: "12px 14px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.popup, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", textAlign: "left" }}
          dir="ltr"
        >
          <EarlierList
            c={c}
            {...list}
            onOpen={(s) => {
              setOpen(false);
              onOpen(s);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** A small outlined button for a transcript's header (Earlier, Back to live). */
export function HeaderButton({ c, data, expanded, onClick, children }: { c: ChromeTokens; data: string; expanded?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      {...{ [`data-${data}`]: "" }}
      aria-expanded={expanded}
      onClick={onClick}
      className="readr-hover"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 6, border: `1px solid ${c.border}`, background: expanded ? c.hover : "transparent", color: c.body, fontSize: 12, cursor: "pointer", fontFamily: "inherit", ["--hover" as string]: c.hover }}
    >
      {children}
    </button>
  );
}
