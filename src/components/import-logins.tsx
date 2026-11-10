import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { KIND_LABEL, suggestRows, type Classification } from "../../shared/site-kinds";
import { api } from "../lib/api";
import { useReadrSettings } from "../shell/settings-provider";
import { Dialog } from "./dialog";

const BROWSERS = [["vivaldi", "Vivaldi"], ["safari", "Safari"], ["chrome", "Chrome"], ["brave", "Brave"], ["firefox", "Firefox"], ["edge", "Edge"], ["opera", "Opera"]] as const;
const CHUNK = 20;

type Phase = "start" | "reading" | "list" | "importing" | "done";

/** Modal, opened by `trigger`: pick a browser, read which sites it holds logins for, tick the ones to copy into Readr. */
export function ImportLogins({ trigger }: { trigger: React.ReactElement }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog trigger={trigger} open={open} onOpenChange={setOpen} title={t("importLogins.title")} intro={t("importLogins.intro")} data-import-logins>
      <ImportLoginsBody onClose={() => setOpen(false)} />
    </Dialog>
  );
}

/** What the dialog holds. It exists only while the dialog is open: closing it stops the suggestion model. */
function ImportLoginsBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { c } = useReadrSettings();
  const [browser, setBrowser] = useState<string>("vivaldi");
  const [phase, setPhase] = useState<Phase>("start");
  const [error, setError] = useState("");
  const [sites, setSites] = useState<{ site: string; cookies: number }[]>([]);
  const [always, setAlways] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [classes, setClasses] = useState<Record<string, Classification>>({});
  // What the user ticked or unticked themselves; the model never overrides these.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [imported, setImported] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    api.importDialogOpen().then((r) => {
      if (!alive.current) return;
      if (r.browser) setBrowser(r.browser);
      setChosen(r.chosen);
    }, () => undefined);
    return () => {
      alive.current = false;
      api.importDialogClose().catch(() => undefined);
    };
  }, []); // opened once: closing the dialog stops the model, so this must not re-run

  // While suggestions are pending, say so if the model is still starting (first run downloads it).
  useEffect(() => {
    if (!classifying) return setLoadingModel(false);
    let live = true;
    const poll = () => api.modelState().then((m) => live && setLoadingModel(m === "loading"), () => undefined);
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [classifying]);

  const rows = useMemo(() => suggestRows(sites, { always, chosen, classes }), [sites, always, chosen, classes]);
  const isOn = (r: { site: string; tick: boolean }) => manual[r.site] ?? r.tick;
  const ticked = rows.filter(isOn).map((r) => r.site);
  const label = BROWSERS.find(([id]) => id === browser)?.[1] ?? browser;

  const read = async () => {
    setPhase("reading");
    setError("");
    const r = await api.browserSites(browser).catch((e) => ({ ok: false as const, error: String(e?.message ?? e), sites: [], always: [], chosen: [], classes: {} }));
    if (!alive.current) return;
    if (!r.ok) {
      setError(r.error ?? t("importLogins.failed"));
      setPhase("start");
      return;
    }
    setSites(r.sites);
    setAlways(r.always);
    setChosen(r.chosen);
    setClasses(r.classes);
    setManual({});
    setPhase("list");
    // Suggestions arrive in the background; the list is usable right away.
    const todo = r.sites.map((s) => s.site).filter((s) => !r.classes[s] && !r.always.includes(s)).slice(0, 100);
    if (todo.length === 0) return;
    setClassifying(true);
    for (let i = 0; i < todo.length && alive.current; i += CHUNK) {
      const found = await api.classifySites(todo.slice(i, i + CHUNK)).catch(() => ({}));
      if (Object.keys(found).length === 0 && i === 0) break; // no model: the user picks
      if (alive.current) setClasses((prev) => ({ ...prev, ...found }));
    }
    if (alive.current) setClassifying(false);
  };

  const toggle = (site: string, sensitive: boolean, on: boolean) => {
    if (!on && sensitive) return setConfirm(site);
    setManual((m) => ({ ...m, [site]: !on }));
  };

  const run = async () => {
    setPhase("importing");
    setError("");
    const r = await api.importLogins(browser, ticked).catch((e) => ({ ok: false as const, imported: 0, domains: [] as string[], error: String(e?.message ?? e) }));
    if (!alive.current) return;
    if (!r.ok) {
      setError(r.error ?? t("importLogins.failed"));
      setPhase("list");
      return;
    }
    setImported(ticked.filter((s) => r.domains.some((d) => d === s || d.endsWith(`.${s}`))).length);
    setPhase("done");
  };

  const shown = rows.filter((r) => r.site.includes(query.trim().toLowerCase()));
  const btn = (primary: boolean): React.CSSProperties => ({
    padding: "5px 16px", fontSize: 12, borderRadius: 5, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${primary ? c.text : c.border}`, background: primary ? c.text : "transparent", color: primary ? c.panel : c.body,
  });

  return (
    <>
      {phase === "done" ? (
        <div data-import-result style={{ padding: "18px 16px", fontSize: 13, color: c.text, lineHeight: 1.5 }}>
          {imported === 0 ? t("importLogins.noneFound", { browser: label }) : t("importLogins.imported", { count: imported })}
          <div style={{ fontSize: 11, color: c.muted, marginTop: 4 }}>{t("importLogins.refreshNote")}</div>
        </div>
      ) : (
        <>
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", borderBottom: phase === "list" ? `1px solid ${c.border}` : "none" }}>
            <select
              aria-label={t("importLogins.browser")}
              data-browser
              value={browser}
              onChange={(e) => setBrowser(e.target.value)}
              disabled={phase === "reading" || phase === "importing"}
              style={{ flex: 1, padding: "5px 8px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.border}`, background: c.popup, color: c.text, fontFamily: "inherit" }}
            >
              {BROWSERS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <button data-read onClick={read} disabled={phase === "reading" || phase === "importing"} style={btn(phase === "start")}>
              {t(phase === "reading" ? "importLogins.reading" : phase === "start" ? "importLogins.read" : "importLogins.readAgain")}
            </button>
          </div>
          {(phase === "start" || phase === "reading") && (
            <div style={{ padding: "0 16px 12px", fontSize: 11, color: c.muted, lineHeight: 1.45 }}>
              {t("importLogins.keychain", { browser: label })}
            </div>
          )}
          {error && <div data-import-error style={{ padding: "0 16px 12px", fontSize: 11, color: "#B4543A", lineHeight: 1.45 }}>{error}</div>}
        </>
      )}

      {phase === "list" || phase === "importing" ? (
        <>
          <div style={{ padding: "8px 16px 4px" }}>
            <input
              data-search
              placeholder={t("importLogins.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.border}`, background: "transparent", color: c.text, fontFamily: "inherit" }}
            />
            <div style={{ fontSize: 10, color: c.muted, marginTop: 4 }}>
              {[t("importLogins.counts", { sites: rows.length, ticked: ticked.length }), classifying ? t("importLogins.suggesting") : ""].filter(Boolean).join(" · ")}
            </div>
            {loadingModel && (
              <div data-model-note style={{ fontSize: 10, color: c.muted, marginTop: 2 }}>{t("importLogins.downloadingModel")}</div>
            )}
          </div>
          <div style={{ overflowY: "auto", padding: "4px 0", minHeight: 80 }}>
            {shown.length === 0 && <div style={{ padding: "10px 16px", fontSize: 12, color: c.muted }}>{t("importLogins.noLogins", { browser: label })}</div>}
            {shown.map((r) => {
              const on = isOn(r);
              return (
                <React.Fragment key={r.site}>
                  <button
                    role="checkbox"
                    aria-checked={on}
                    data-site={r.site}
                    data-sensitive={r.sensitive || undefined}
                    onClick={() => toggle(r.site, r.sensitive, on)}
                    className="readr-hover"
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: c.text, fontSize: 13, ["--hover" as string]: c.hover }}
                  >
                    <span style={{ width: 15, height: 15, borderRadius: 4, border: `1px solid ${on ? c.text : c.border}`, background: on ? c.text : "transparent", color: c.popup, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.site}</span>
                    {r.kind && <span style={{ fontSize: 10, color: r.sensitive ? "#B4543A" : c.muted }}>{KIND_LABEL[r.kind]}</span>}
                    <span style={{ fontSize: 10, color: c.muted, minWidth: 40, textAlign: "right" }}>{r.cookies}</span>
                  </button>
                  {confirm === r.site && (
                    <div data-confirm style={{ margin: "2px 16px 6px", padding: "8px 10px", borderRadius: 6, background: c.chip, fontSize: 11, color: c.body, lineHeight: 1.45 }}>
                      {t("importLogins.sensitive", { site: r.site, kind: r.kind ? KIND_LABEL[r.kind].toLowerCase() : t("importLogins.sensitiveKind") })}
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button data-confirm-yes onClick={() => { setManual((m) => ({ ...m, [r.site]: true })); setConfirm(null); }} style={btn(true)}>{t("importLogins.importIt")}</button>
                        <button data-confirm-no onClick={() => setConfirm(null)} style={btn(false)}>{t("importLogins.cancel")}</button>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </>
      ) : null}

      <div style={{ padding: "10px 16px", borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto" }}>
        <button onClick={onClose} style={btn(false)}>{t(phase === "done" ? "importLogins.close" : "importLogins.cancel")}</button>
        {(phase === "list" || phase === "importing") && (
          <button data-import onClick={run} disabled={phase === "importing" || ticked.length === 0} style={btn(true)}>
            {phase === "importing" ? t("importLogins.importing") : t("importLogins.import", { count: ticked.length })}
          </button>
        )}
      </div>
    </>
  );
}
