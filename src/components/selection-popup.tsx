// The answer to the right-click menu's Translate or Add to flashcards, in the word popup's style: the
// (snapped) text and its dictionary form, then the translation or the card that was added.

import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChromeKey } from "../i18n";
import { languageScope } from "../lib/language-scope";
import { SERIF, type ChromeTokens } from "../lib/theme";
import { NOTICES, addedNote, type SelectionResult } from "../lib/selection-actions";
import type { SelectionTranslation } from "../../shared/types";
import { IconButton, LoadingLines, PopupBody, PopupFrame, PopupHeader, SentenceQuote } from "./popup";

/** Why a translation is missing: its key in en.json "selection". */
const WHY_NOT: Record<Exclude<SelectionTranslation, { ok: true }>["reason"], ChromeKey> = {
  unavailable: "selection.unavailable",
  offline: "selection.offline",
  empty: "selection.empty",
};

/** `lang` is the selected text's language: its headword is set in that language's face. */
export function SelectionPopup({ c, lang, result, onClose }: { c: ChromeTokens; lang: string; result: SelectionResult; onClose: () => void }) {
  const { t } = useTranslation();
  const headword = languageScope(lang).contentFont;
  const { action, text, form, definition, translation, stage } = result;
  const showForm = form && form.toLowerCase() !== text.toLowerCase();
  const note = (s: string) => <p style={{ fontSize: 12, lineHeight: 1.6, color: c.body, margin: "0 0 10px" }}>{s}</p>;
  const translated = translation && translation !== "pending" && translation.ok ? translation.text : "";

  return (
    <PopupFrame c={c} rect={result.rect} onClose={onClose} data-selection-popup={action} data-stage={stage}>
      <PopupHeader c={c}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div data-selection-text dir="auto" lang={lang} style={{ fontSize: 20, fontWeight: 600, color: c.text, fontFamily: headword, lineHeight: 1.3 }}>
              {text}
            </div>
            {showForm && (
              <div data-selection-form style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                {t("selection.from")} <span dir="auto" lang={lang} style={{ color: c.text, fontFamily: headword }}>{form}</span>
              </div>
            )}
          </div>
          <IconButton c={c} title={t("selection.close")} onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </PopupHeader>

      <PopupBody>
        {stage === "working" && <LoadingLines c={c} />}
        {stage === "notice" && <div data-selection-notice>{note(result.notice ?? "")}</div>}

        {stage === "done" && result.added && (
          <div data-selection-added style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: c.text, marginBottom: 10 }}>
            <Check size={14} color={c.accent} style={{ flexShrink: 0 }} />
            {addedNote(result.added, translation, Boolean(definition))}
          </div>
        )}
        {stage === "done" && result.added && result.clip === "unavailable" && (
          <div data-selection-no-audio style={{ fontSize: 12, color: c.muted, margin: "-4px 0 10px 20px" }}>
            {NOTICES.noAudio}
          </div>
        )}

        {stage === "done" && (
          <div data-selection-translation>
            {translation === "pending" ? (
              <div className="readr-shimmer" style={{ height: 12, width: "55%", background: c.border, borderRadius: 3, margin: "2px 0 12px" }} />
            ) : translated ? (
              <p dir="auto" style={{ fontSize: 15, lineHeight: 1.5, color: c.text, margin: "0 0 10px", fontFamily: SERIF }}>{translated}</p>
            ) : action === "translate" && translation && !translation.ok ? (
              note(t(WHY_NOT[translation.reason]))
            ) : null}
          </div>
        )}

        {stage !== "working" && definition && (
          <div data-selection-definition style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0 10px", borderTop: `1px solid ${c.border}` }}>
            <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0, paddingTop: 2 }}>{t("selection.dictionary")}</span>
            <span dir="auto" style={{ fontSize: 12, color: c.text, textAlign: "right", lineHeight: 1.45 }}>{definition}</span>
          </div>
        )}

        {result.context && <SentenceQuote c={c} sentence={result.context} span={result.span} />}
      </PopupBody>
    </PopupFrame>
  );
}
