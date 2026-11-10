// "Add a newspaper or site" under the language's sources: a dialog with the free catalog for the language first
// and a pasted address second. A source added either way opens its newspaper page.

import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, languageInfo } from "../../shared/languages";
import type { DiscoveredSource, Lang } from "../../shared/types";
import { api } from "../lib/api";
import type { ChromeTokens } from "../lib/theme";
import { useReadrSettings } from "../shell/settings-provider";
import { Dialog } from "./dialog";
import { FindSources } from "./find-sources";

interface Props {
  lang: Lang;
  /** The button that opens the dialog. */
  trigger: React.ReactElement;
  /** A source was added (or an added one picked): reload the lists, then open it. A failure is shown in the dialog. */
  onAdded: (sourceId: string) => void | Promise<void>;
}

/** The "Add a newspaper or site" dialog, opened by `trigger`. */
export function AddSource({ lang, trigger, onAdded }: Props) {
  const { t } = useTranslation();
  const { c, tokens, dark } = useReadrSettings();
  const [open, setOpen] = useState(false);
  // After an add the app goes to the new source's page: the focus stays there, not back on the trigger.
  const wentElsewhere = useRef(false);
  const added = async (id: string) => {
    await onAdded(id);
    wentElsewhere.current = true;
    setOpen(false);
  };
  return (
    <Dialog
      trigger={trigger}
      open={open}
      onOpenChange={(next) => {
        wentElsewhere.current = false;
        setOpen(next);
      }}
      title={t("sources.add")}
      intro={t("sources.dialogIntro")}
      width={520}
      onCloseAutoFocus={(event) => wentElsewhere.current && event.preventDefault()}
      data-add-source-dialog
    >
      <div style={{ overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
        <FindSources lang={lang} tokens={tokens} dark={dark} variant="dialog" onPick={added} />
        <PasteAddress c={c} lang={lang} onAdded={added} />
      </div>
      <div style={{ padding: "10px 16px", borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
        <button onClick={() => setOpen(false)} style={secondary(c)}>{t("sources.close")}</button>
      </div>
    </Dialog>
  );
}

const secondary = (c: ChromeTokens): React.CSSProperties => ({ padding: "5px 14px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.body, cursor: "pointer", fontFamily: "inherit" });

/** Paste a site: Readr reads its name and RSS feed from the homepage (in the logged-in session), you confirm. */
function PasteAddress({ c, lang, onAdded }: { c: ChromeTokens; lang: Lang; onAdded: (sourceId: string) => void | Promise<void> }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<DiscoveredSource | null>(null);
  const [name, setName] = useState("");
  const [chosenLang, setChosenLang] = useState(lang);
  const [error, setError] = useState("");

  const discover = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    const r = await api.discoverSource(url.trim()).catch((e) => ({ ok: false, error: String(e?.message ?? e), source: undefined }));
    setBusy(false);
    if (!r.ok || !r.source) return setError(r.error ?? t("sources.openFailed"));
    setFound(r.source);
    setName(r.source.name);
    setChosenLang(r.source.lang ?? lang);
  };
  const add = async () => {
    if (!found) return;
    setBusy(true);
    setError("");
    try {
      const entry = await api.addSource({ ...found, name, lang: chosenLang });
      await onAdded(entry.id);
    } catch {
      setError(t("sources.addFailed"));
    }
    setBusy(false);
  };
  const back = () => {
    setFound(null);
    setError("");
  };

  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.text, outline: "none", fontFamily: "inherit" };
  return (
    <section data-paste-address style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: c.text }}>{t("sources.pasteHeading")}</h2>
      <form onSubmit={(e) => { e.preventDefault(); if (!busy) void (found ? add() : discover()); }} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!found ? (
        <input data-address value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("sources.addressPlaceholder")} aria-label={t("sources.pasteHeading")} style={input} />
      ) : (
        <>
          <input data-source-name-input dir="auto" value={name} onChange={(e) => setName(e.target.value)} style={input} />
          <select data-source-lang value={chosenLang} onChange={(e) => setChosenLang(e.target.value)} style={input} title={t("sources.language")} aria-label={t("sources.language")}>
            {[...new Set([chosenLang, ...Object.keys(LANGUAGES)])].sort((a, b) => languageInfo(a).name.localeCompare(languageInfo(b).name)).map((code) => (
              <option key={code} value={code}>{languageInfo(code).name} · {languageInfo(code).native}</option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: c.muted, lineHeight: 1.4 }}>
            {t(found.feedUrl ? "sources.rssFound" : "sources.noRss")}{" "}
            {found.lang ? t("sources.siteSays", { language: languageInfo(found.lang).name }) : t("sources.siteUnknown")}
          </div>
        </>
      )}
      {error && <div data-address-error style={{ fontSize: 11, color: c.body, lineHeight: 1.4 }}>{error}</div>}
      {error.includes("confirm they're human") && (
        <button
          type="button"
          onClick={async () => {
            const site = /^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
            await api.openOriginal(site); // a normal window in Readr's session; resolves when closed
            void discover();
          }}
          style={{ ...secondary(c), alignSelf: "flex-start" }}
        >
          {t("sources.openSite")}
        </button>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button data-address-go type="submit" disabled={busy || (!found && !url.trim())} style={{ ...secondary(c), border: `1px solid ${c.text}`, background: c.text, color: c.panel }}>
          {t(busy ? "sources.reading" : found ? "sources.addButton" : "sources.find")}
        </button>
        {found && <button type="button" onClick={back} style={secondary(c)}>{t("sources.changeAddress")}</button>}
      </div>
      </form>
    </section>
  );
}
