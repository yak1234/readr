// The word popup's frame, shared by the dictionary popup and the selection popup: a card placed
// below the text it points at (above when there is no room), closed by Escape or a click outside.

import React, { useEffect } from "react";
import type { ChromeTokens } from "../lib/theme";
import { UI_FONT } from "../lib/theme";

export const POPUP_W = 320;
const ROOM = 340; // what the popup usually needs below the text before it goes above instead

export function PopupFrame({ c, rect, onClose, children, ...rest }: { c: ChromeTokens; rect: DOMRect; onClose: () => void; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const left = Math.max(12, Math.min(rect.left, window.innerWidth - POPUP_W - 12));
  const below = rect.bottom + 10;
  const placeAbove = below + ROOM > window.innerHeight && rect.top > window.innerHeight - below;
  const room = placeAbove ? rect.top - 22 : window.innerHeight - below - 12;
  const position: React.CSSProperties = placeAbove ? { bottom: window.innerHeight - rect.top + 10 } : { top: below };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={onClose} />
      <div
        role="dialog"
        {...rest}
        style={{
          position: "fixed",
          left,
          ...position,
          width: POPUP_W,
          maxHeight: Math.max(120, Math.min(420, room)),
          display: "flex",
          flexDirection: "column",
          background: c.popup,
          border: `1px solid ${c.border}`,
          borderRadius: 10,
          boxShadow: "0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)",
          zIndex: 100,
          fontFamily: UI_FONT,
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {children}
      </div>
    </>
  );
}

/** The popup's header band. */
export function PopupHeader({ c, children }: { c: ChromeTokens; children: React.ReactNode }) {
  return <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${c.border}`, background: c.popupHeader }}>{children}</div>;
}

/** The popup's scrolling body. */
export function PopupBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "14px 16px 16px", overflowY: "auto" }}>{children}</div>;
}

export function IconButton({ c, title, onClick, children }: { c: ChromeTokens; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: c.muted, borderRadius: 4, display: "flex" }}>
      {children}
    </button>
  );
}

export function LoadingLines({ c }: { c: ChromeTokens }) {
  return (
    <div>
      {["90%", "70%", "80%"].map((w, i) => (
        <div key={i} className="readr-shimmer" style={{ height: 10, width: w, background: c.border, borderRadius: 3, marginBottom: 8 }} />
      ))}
    </div>
  );
}

/** The sentence the text was met in, as the popups quote it; `span` (UTF-16 offsets) is marked. */
export function SentenceQuote({ c, sentence, span, translation }: { c: ChromeTokens; sentence: string; span?: [number, number] | null; translation?: string }) {
  const marked = span && span[0] < span[1] ? (
    <>
      {sentence.slice(0, span[0])}
      <span data-quote-span style={{ fontStyle: "normal", fontWeight: 600, color: c.text }}>{sentence.slice(span[0], span[1])}</span>
      {sentence.slice(span[1])}
    </>
  ) : (
    sentence
  );
  return (
    <div dir="auto" style={{ fontSize: 12, fontStyle: "italic", color: c.body, lineHeight: 1.5, marginTop: 4, padding: "8px 10px", background: c.chip, borderRadius: 5, borderLeft: `2px solid ${c.accent}` }}>
      {marked}
      {translation && <div style={{ fontStyle: "normal", color: c.muted, marginTop: 6 }}>{translation}</div>}
    </div>
  );
}
