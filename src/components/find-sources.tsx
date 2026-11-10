// "Find sources for {language}": the free-source catalog's entries for one language, each with Add. A
// language with no sources yet shows it in place of its front page; one with sources shows it below.

import { useCallback, useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CatalogSource } from "../../shared/types";
import { api } from "../lib/api";
import { SERIF, UI_FONT, type ReadingTokens } from "../lib/theme";
import { languageScope } from "../lib/language-scope";
import { useReadrNavigate } from "../shell/navigation";
import { AddSource } from "./add-source";

interface Props {
  lang: string;
  tokens: ReadingTokens;
  dark: boolean;
  /** "find" when the language has no sources yet, "more" beneath its front page, "dialog" inside the add dialog. */
  variant?: "find" | "more" | "dialog";
  /** After a source is added or removed (the sidebar and Home reload theirs). */
  onChanged?: () => void | Promise<void>;
  /** With this, adding a source reports it (its id) and a source already added opens instead of being removed. */
  onPick?: (sourceId: string) => void | Promise<void>;
}

export function FindSources({ lang, tokens, dark, variant = "find", onChanged, onPick }: Props) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<CatalogSource[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const refresh = useCallback(
    () =>
      api.catalog().then(
        (list) => {
          setCatalog(list);
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [],
  );
  useEffect(() => void refresh(), [refresh]);

  const nav = useReadrNavigate();
  const content = languageScope(lang);
  const language = content.native;
  const here = (catalog ?? []).filter((x) => x.lang === lang);

  const toggle = async (src: CatalogSource) => {
    const id = `cat-${src.id}`;
    setActionFailed(false);
    try {
      if (src.added && onPick) return await onPick(id);
      if (src.added) await api.removeSource(id);
      else await api.addCatalogSource(src.id);
      await refresh();
      onChanged?.();
      if (!src.added) await onPick?.(id);
    } catch {
      setActionFailed(true);
    }
  };
  const heading = variant === "find" ? "findSources.title" : variant === "more" ? "findSources.more" : "findSources.free";

  return (
    <section data-find-sources={lang} data-catalog dir="ltr">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: variant === "dialog" ? 10 : 18 }}>
        <h2 style={{ fontFamily: SERIF, fontSize: variant === "find" ? 24 : variant === "more" ? 19 : 15, fontWeight: 600, letterSpacing: "-0.2px", whiteSpace: "nowrap", margin: 0 }}>
          {t(heading, { language })}
        </h2>
        <div style={{ flex: 1, height: 1, background: tokens.border }} />
      </div>
      {variant !== "dialog" && <div style={{ fontSize: 12, color: tokens.secondary, margin: "-6px 0 18px" }}>{t("findSources.intro")}</div>}
      {failed && <div data-catalog-failed role="status" style={{ fontSize: 12, color: tokens.secondary }}>{t("findSources.loadFailed")}</div>}
      {actionFailed && <div data-add-failed role="status" style={{ fontSize: 12, color: tokens.secondary, marginBottom: 10 }}>{t("findSources.addFailed")}</div>}
      {!failed && catalog && here.length === 0 && <div style={{ fontSize: 12, color: tokens.secondary }}>{t("findSources.none", { language })}</div>}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${variant === "dialog" ? 170 : 200}px, 1fr))`, gap: 10 }}>
        {here.map((src) => (
          <div key={src.id} data-catalog-source={src.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`, background: src.added ? (dark ? "#2F2D29" : "#F2F0EB") : "transparent" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div dir="auto" lang={lang} style={{ fontSize: 13 * content.contentScale, fontWeight: 500, fontFamily: content.contentFont, textAlign: "start" }}>{src.name}</div>
              <div dir="auto" lang={lang} style={{ fontSize: 10, color: tokens.secondary, marginTop: 2, textAlign: "start" }}>{src.note}</div>
            </div>
            <button
              onClick={() => toggle(src)}
              title={t(src.added ? (onPick ? "findSources.open" : "findSources.remove") : "findSources.add")}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontFamily: UI_FONT, border: `1px solid ${src.added ? tokens.border : tokens.text}`, background: src.added ? "transparent" : tokens.text, color: src.added ? tokens.secondary : tokens.bg }}
            >
              {src.added ? <Check size={11} /> : <Plus size={11} />}
              {t(src.added ? (onPick ? "findSources.open" : "findSources.added") : "findSources.add")}
            </button>
          </div>
        ))}
      </div>
      {variant !== "dialog" && (
        <div style={{ marginTop: 16 }}>
          <AddSource
            lang={lang}
            onAdded={async (id) => {
              await onChanged?.();
              nav.toSource(id);
            }}
            trigger={
              <button data-add-source-button style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: UI_FONT, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text }}>
                <Plus size={12} />
                {t("sources.add")}
              </button>
            }
          />
        </div>
      )}
    </section>
  );
}
