import React, { useState } from "react";
import { Download, ExternalLink, LogIn, Star, Archive, Trash2 } from "lucide-react";
import type { Article, SidecarStatus, Site } from "../../shared/types";
import type { ChromeTokens, FocusMode, ReadingFont, ReadingStyle } from "../lib/theme";
import type { Settings } from "../lib/settings";
import { api } from "../lib/api";
import { ChipButton, Divider, SectionLabel, Slider, Switch } from "./ui";

interface Props {
  c: ChromeTokens;
  article: Article | null;
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  readingProgress: number;
  sites: Site[];
  onLogin: (siteId: string) => void;
  onViewOriginal: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  status: SidecarStatus | null;
  translatedCount: number;
}

const styles: { id: ReadingStyle; label: string; bg: string; fg: string }[] = [
  { id: "light", label: "Light", bg: "#FFFFFF", fg: "#1C1B18" },
  { id: "sepia", label: "Sepia", bg: "#F5EFE0", fg: "#4A3F2F" },
  { id: "dark", label: "Dark", bg: "#2A2825", fg: "#E8E6E0" },
  { id: "paper", label: "Paper", bg: "#F9F6EF", fg: "#3A3730" },
];

const fonts: { id: ReadingFont; label: string; family: string }[] = [
  { id: "georgia", label: "Georgia", family: "Georgia, serif" },
  { id: "literata", label: "Literata", family: "'Literata', Georgia, serif" },
  { id: "source", label: "Serif", family: "'Source Serif 4', 'Source Serif Pro', Georgia, serif" },
];

const focusModes: { id: FocusMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "No focus aid" },
  { id: "article", label: "Article", hint: "Hide both side panels" },
  { id: "sentence", label: "Sentence", hint: "Dim everything except the sentence under the cursor" },
  { id: "line", label: "Line", hint: "Reading ruler that follows the cursor" },
];

export function RightPanel(props: Props) {
  const { c, article, settings, update, readingProgress, sites, onLogin, onViewOriginal, status } = props;

  return (
    <aside
      style={{
        width: 210,
        minWidth: 210,
        background: c.panel,
        borderLeft: `1px solid ${c.border}`,
        overflowY: "auto",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ padding: "20px 16px" }}>
        <SectionLabel c={c}>Style</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {styles.map((s) => {
            const active = settings.readingStyle === s.id;
            return (
              <button
                key={s.id}
                onClick={() => update("readingStyle", s.id)}
                style={{
                  padding: "6px 4px",
                  borderRadius: 5,
                  border: active ? `1.5px solid ${c.accent}` : `1.5px solid ${c.border}`,
                  background: s.bg,
                  fontSize: 11,
                  color: active ? s.fg : "#6B6963",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: active ? "0 0 0 2px rgba(184,169,138,0.2)" : "none",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <Divider c={c} />

        <SectionLabel c={c}>Text Size</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: c.muted }}>A</span>
          <Slider c={c} value={settings.fontSize} onChange={(v) => update("fontSize", v)} min={80} max={160} step={10} />
          <span style={{ fontSize: 14, color: c.muted, fontWeight: 500 }}>A</span>
        </div>
        <div style={{ fontSize: 11, color: c.faint, marginTop: 4, textAlign: "center" }}>{settings.fontSize}%</div>

        <Divider c={c} />

        <SectionLabel c={c}>Font</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {fonts.map((f) => (
            <ChipButton key={f.id} c={c} active={settings.font === f.id} onClick={() => update("font", f.id)} style={{ fontFamily: f.family, fontSize: 13, textAlign: "left", padding: "6px 10px" }}>
              {f.label}
            </ChipButton>
          ))}
        </div>

        <Divider c={c} />

        <SectionLabel c={c}>Focus</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {focusModes.map((f) => (
            <ChipButton key={f.id} c={c} title={f.hint} active={settings.focusMode === f.id} onClick={() => update("focusMode", f.id)}>
              {f.label}
            </ChipButton>
          ))}
        </div>

        <Divider c={c} />

        <SectionLabel c={c}>Translation</SectionLabel>
        <ToggleRow c={c} label="Show translation" checked={settings.viewMode !== "original"} onChange={(v) => update("viewMode", v ? "interlinear" : "original")} />
        <ToggleRow c={c} label="Hide until hover" checked={settings.blurTranslation} onChange={(v) => update("blurTranslation", v)} />

        {article && (
          <>
            <Divider c={c} />
            <SectionLabel c={c}>About this article</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <MetaRow c={c} label="Published" value={article.date || "—"} />
              <MetaRow c={c} label="Author" value={article.author || "—"} />
              <MetaRow c={c} label="Read time" value={`${article.readingTime} min`} />
              <MetaRow c={c} label="Translated" value={`${props.translatedCount} sentences`} />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Progress</span>
                <span style={{ fontSize: 10, color: c.muted }}>{readingProgress}%</span>
              </div>
              <div style={{ height: 3, background: c.border, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${readingProgress}%`, background: c.accent, transition: "width 0.3s ease" }} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
              <ChipButton c={c} title="Favorite" active={!!article.favorite} onClick={props.onToggleFavorite} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <Star size={12} />
              </ChipButton>
              <ChipButton c={c} title="Archive" active={!!article.archived} onClick={props.onToggleArchive} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <Archive size={12} />
              </ChipButton>
              <ChipButton c={c} title="Remove from library" active={false} onClick={props.onDelete} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <Trash2 size={12} />
              </ChipButton>
            </div>

            <Divider c={c} />

            <OutlineButton c={c} onClick={onViewOriginal}>
              <ExternalLink size={12} />
              View Original
            </OutlineButton>
          </>
        )}

        <Divider c={c} />

        <SectionLabel c={c}>Subscriptions</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {sites.map((s) => (
            <OutlineButton key={s.id} c={c} onClick={() => onLogin(s.id)}>
              <LogIn size={12} />
              {s.name}
            </OutlineButton>
          ))}
        </div>
        <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, marginTop: 6 }}>
          Opens the site in a window that shares Readr's session. Sign in once; it stays signed in.
        </div>
        <BrowserLogin c={c} />

        <Divider c={c} />

        <SectionLabel c={c}>Engine</SectionLabel>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11, color: c.body, lineHeight: 1.45 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, marginTop: 4, flexShrink: 0, background: status?.ok ? "#7A9A5E" : "#C2884A" }} />
          <span>
            {status?.ok
              ? `${status.translator || "translator"}${status.spacy ? " · spaCy" : ""}${status.dictionary ? " · Wiktionary" : ""}`
              : status?.message ?? "Checking…"}
          </span>
        </div>
      </div>
    </aside>
  );
}

function ToggleRow({ c, label, checked, onChange }: { c: ChromeTokens; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: c.body }}>{label}</span>
      <Switch c={c} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function MetaRow({ c, label, value }: { c: ChromeTokens; label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
      <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: c.text, textAlign: "right", lineHeight: 1.3 }}>{value}</span>
    </div>
  );
}

function OutlineButton({ c, onClick, children }: { c: ChromeTokens; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="readr-outline"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width: "100%",
        padding: 8,
        borderRadius: 6,
        border: `1.5px solid ${c.border}`,
        background: "transparent",
        fontSize: 12,
        color: c.body,
        cursor: "pointer",
        fontFamily: "inherit",
        ["--accent" as string]: c.accent,
        ["--text" as string]: c.text,
      }}
    >
      {children}
    </button>
  );
}

/** Copy existing logins from the user's everyday browser (for sites signed in
 * with Google, which won't sign in inside an app). */
function BrowserLogin({ c }: { c: ChromeTokens }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const run = async (browser: "vivaldi" | "safari", label: string) => {
    setBusy(browser);
    setMessage(`Reading ${label}'s logins… macOS may ask to allow access.`);
    const r = await api.importBrowserLogins(browser).catch((e) => ({ ok: false as const, error: String(e?.message ?? e) }));
    setBusy(null);
    if (!r.ok) setMessage(r.error ?? "Something went wrong.");
    else if (r.imported === 0) setMessage(`No logins for these sites found in ${label}. Sign in there first.`);
    else setMessage(`Copied your ${label} login for ${r.domains.join(", ")}.`);
  };
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
      {([["vivaldi", "Vivaldi"], ["safari", "Safari"]] as const).map(([id, label]) => (
        <OutlineButton key={id} c={c} onClick={() => !busy && run(id, label)}>
          <Download size={12} />
          {busy === id ? "Copying…" : `Use my ${label} login`}
        </OutlineButton>
      ))}
      <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.5, marginTop: 2 }}>
        {message || "Signed in with Google? Sign in in your browser, then copy that login here. Only these sites' cookies are copied."}
      </div>
    </div>
  );
}
