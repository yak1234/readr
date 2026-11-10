import React, { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Section } from "../../shared/types";
import { api } from "../lib/api";
import type { ChromeTokens } from "../lib/theme";
import { selectionToSave } from "../../shared/section-choice";

interface Props {
  c: ChromeTokens;
  sourceId: string;
  sourceName: string;
  onClose: () => void;
  /** Called after the choice is saved, so the sidebar and Accueil reload their feeds. */
  onSaved: () => void;
}

/** Popup listing every section a source offers; tick the ones to follow. */
export function SectionPicker({ c, sourceId, sourceName, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<Section[] | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    api.sourceSections(sourceId).then(
      (r) => {
        if (!live) return;
        setSections(r.sections);
        setTicked(r.followed);
      },
      () => live && setSections([]),
    );
    return () => {
      live = false;
    };
  }, [sourceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const done = async () => {
    // Keep the order shown in the popup; an empty list never overwrites the choice.
    const ids = selectionToSave(sections ?? [], ticked);
    if (ids) {
      await api.followSections(sourceId, ids);
      onSaved();
    }
    onClose();
  };

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.12)" }} onClick={onClose} />
      <div
        role="dialog"
        data-section-picker
        aria-label={t("sectionPicker.label", { source: sourceName })}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 340,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: c.popup,
          border: `1px solid ${c.border}`,
          borderRadius: 10,
          boxShadow: "0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)",
          zIndex: 100,
          fontFamily: "'Inter', system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${c.border}`, background: c.popupHeader }}>
          <div dir="auto" style={{ fontSize: 18, fontWeight: 600, color: c.text, fontFamily: "Georgia, serif", lineHeight: 1.3, textAlign: "start" }}>{sourceName}</div>
          <div style={{ fontSize: 11, color: c.muted, marginTop: 2 }}>{t("sectionPicker.following")}</div>
        </div>
        <div style={{ overflowY: "auto", padding: "6px 0" }}>
          {sections === null && <div style={{ padding: "10px 16px", fontSize: 12, color: c.muted }}>{t("sectionPicker.finding")}</div>}
          {sections?.length === 0 && (
            <div style={{ padding: "10px 16px", fontSize: 12, color: c.muted, lineHeight: 1.45 }}>{t("sectionPicker.none")}</div>
          )}
          {sections?.map((s) => {
            const on = ticked.includes(s.id);
            return (
              <button
                key={s.id}
                role="checkbox"
                aria-checked={on}
                data-section={s.id}
                onClick={() => toggle(s.id)}
                className="readr-hover"
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "7px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: c.text, fontSize: 13, ["--hover" as string]: c.hover }}
              >
                <span
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 4,
                    border: `1px solid ${on ? c.text : c.border}`,
                    background: on ? c.text : "transparent",
                    color: c.popup,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span dir="auto" style={{ textAlign: "start" }}>{s.name}</span>
              </button>
            );
          })}
        </div>
        <div style={{ padding: "10px 16px", borderTop: `1px solid ${c.border}`, display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={done}
            disabled={sections === null}
            style={{ padding: "5px 16px", fontSize: 12, borderRadius: 5, border: `1px solid ${c.text}`, background: c.text, color: c.panel, cursor: "pointer" }}
          >
            {t(sections?.length === 0 ? "sectionPicker.close" : "sectionPicker.done")}
          </button>
        </div>
      </div>
    </>
  );
}
