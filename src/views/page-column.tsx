// A page of rows in the main column: a heading, then the rows, at a readable width.

import React from "react";
import { SERIF, UI_FONT } from "../lib/theme";
import { useReadrSettings } from "../shell/settings-provider";

export function PageColumn({ title, titleDir, actions, data, children }: { title: string; titleDir?: "auto"; actions?: React.ReactNode; data: string; children: React.ReactNode }) {
  const { c, tokens } = useReadrSettings();
  return (
    <div data-page={data} style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px 64px", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 12, borderBottom: `1px solid ${c.border}` }}>
        <h2 dir={titleDir} style={{ flex: 1, margin: 0, fontFamily: SERIF, fontSize: 26, fontWeight: 600, letterSpacing: "-0.4px", textAlign: "left" }}>{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}
