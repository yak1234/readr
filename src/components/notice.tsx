// The main area's quiet states: an article opening, and a notice with its actions
// (couldn't open, not signed in). The words are English chrome.

import React from "react";
import { useTranslation } from "react-i18next";
import { SERIF, UI_FONT } from "../lib/theme";

export function LoadingArticle({ tokens }: { tokens: { border: string; secondary: string } }) {
  const { t } = useTranslation();
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "48px" }}>
      <div style={{ textAlign: "center", fontSize: 12, color: tokens.secondary, marginBottom: 32, fontFamily: UI_FONT }}>{t("app.opening")}</div>
      {[95, 80, 0, 100, 100, 92, 70, 0, 100, 96, 88].map((w, i) =>
        w === 0 ? <div key={i} style={{ height: 18 }} /> : <div key={i} className="readr-shimmer" style={{ height: i < 2 ? 26 : 12, width: `${w}%`, background: tokens.border, borderRadius: 3, marginBottom: 12 }} />,
      )}
    </div>
  );
}

export function Notice({ tokens, title, body, children }: { tokens: { text: string; secondary: string; border: string }; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 520, margin: "12vh auto 0", padding: "0 32px", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, letterSpacing: "-0.3px", marginBottom: 10 }}>{title}</div>
      {body && <p style={{ fontSize: 14, lineHeight: 1.6, color: tokens.secondary, margin: "0 0 20px" }}>{body}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

export function NoticeButton({ tokens, primary, onClick, children }: { tokens: { text: string; border: string }; primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: 6,
        border: `1.5px solid ${primary ? tokens.text : tokens.border}`,
        background: primary ? tokens.text : "transparent",
        color: primary ? "#FAFAF7" : tokens.text,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: UI_FONT,
      }}
    >
      {children}
    </button>
  );
}
