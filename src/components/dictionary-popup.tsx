import { useEffect, useState } from "react";
import { BookMarked, Check, Volume2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import en from "../i18n/en.json";
import { languageScope } from "../lib/language-scope";
import type { LookupResult } from "../../shared/types";
import { api } from "../lib/api";
import { speakOnce } from "../lib/speech";
import type { ChromeTokens } from "../lib/theme";
import { NOTICES } from "../lib/selection-actions";
import { IconButton, LoadingLines, PopupBody, PopupFrame, PopupHeader, SentenceQuote } from "./popup";

interface Props {
  c: ChromeTokens;
  word: string;
  sentence: string;
  sentenceTranslation: string;
  rect: DOMRect;
  lang: string;
  /** Reader's target language (settings.targetLang). */
  tgt: string;
  voiceURI: string;
  onClose: () => void;
  /** Adds the word to the flashcards (its dictionary form, with this sentence as the example). Null when it
   * couldn't be added; `clip` says whether a live sentence's audio was kept. */
  onSave: (r: { word: string; lemma: string; gloss: string }) => Promise<{ clip?: "saved" | "unavailable" } | null>;
}

type Tab = "definition" | "grammar" | "pronunciation";

const TABS = ["definition", "grammar", "pronunciation"] as const;

/** Universal Dependencies tags and features in English (en.json "dictionary"), else as they came. */
const POS: Record<string, string> = en.dictionary.pos;
const MORPH: Record<string, Record<string, string>> = en.dictionary.morph;
const posLabel = (pos: string) => POS[pos] ?? pos.toLowerCase();
const morphLabel = (feature: string) => MORPH[feature]?.label ?? feature;
const morphValue = (feature: string, value: string) => MORPH[feature]?.[value] ?? value;

export function DictionaryPopup({ c, word, sentence, sentenceTranslation, rect, lang, tgt, voiceURI, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const headword = languageScope(lang).contentFont;
  const [tab, setTab] = useState<Tab>("definition");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [saved, setSaved] = useState<"unsaved" | "yes" | "failed">("unsaved");
  const [noAudio, setNoAudio] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    setSaved("unsaved");
    setNoAudio(false);
    api.lookup(word, sentence, lang, tgt).then(
      (r) => {
        if (!alive) return;
        setResult(r);
        setState(r ? "ready" : "offline");
      },
      () => alive && setState("offline"),
    );
    return () => {
      alive = false;
    };
  }, [word, sentence, lang, tgt]);

  const firstGloss = result?.senses[0]?.glosses[0] || result?.gloss_target || result?.mtGloss || "";
  const lemma = result?.lemma || word;

  return (
    <PopupFrame c={c} rect={rect} onClose={onClose}>
        <PopupHeader c={c}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div dir="auto" lang={lang} style={{ fontSize: 20, fontWeight: 600, color: c.text, fontFamily: headword, lineHeight: 1.3 }}>{word}</div>
              {result && (result.parts?.length ?? 0) > 1 && (
                <div data-word-parts dir="auto" lang={lang} style={{ fontSize: 12, color: c.muted, marginTop: 2, fontFamily: headword }}>
                  {result.parts.map((p) => p.text).join(" + ")}
                </div>
              )}
              {result && result.lemma && result.lemma.toLowerCase() !== word.toLowerCase() && (
                <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                  {t("selection.from")} <span dir="auto" lang={lang} style={{ color: c.text, fontFamily: headword }}>{result.lemma}</span>
                </div>
              )}
              {result?.ipa && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{result.ipa}</div>}
              {result?.pos && (
                <div style={{ display: "inline-block", marginTop: 5, padding: "2px 7px", background: c.chip, borderRadius: 4, fontSize: 10, color: "#8A7B5E", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {posLabel(result.pos)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
              <IconButton c={c} title={t("dictionary.pronounce")} onClick={() => speakOnce(word, lang, 0.9, voiceURI)}>
                <Volume2 size={14} />
              </IconButton>
              <IconButton
                c={c}
                title={t(saved === "yes" ? "dictionary.added" : "dictionary.add")}
                onClick={async () => {
                  if (saved === "yes") return;
                  const added = await onSave({ word, lemma, gloss: firstGloss }).catch(() => null);
                  setSaved(added ? "yes" : "failed");
                  setNoAudio(added?.clip === "unavailable");
                }}
              >
                {saved === "yes" ? <Check size={14} /> : <BookMarked size={14} />}
              </IconButton>
              <IconButton c={c} title={t("dictionary.close")} onClick={onClose}>
                <X size={14} />
              </IconButton>
            </div>
          </div>

          {saved === "failed" && (
            <div data-save-failed style={{ fontSize: 11, color: c.body, marginTop: 6 }}>
              {NOTICES.notAdded}
            </div>
          )}
          {saved === "yes" && noAudio && (
            <div data-save-no-audio style={{ fontSize: 11, color: c.muted, marginTop: 6 }}>
              {NOTICES.noAudio}
            </div>
          )}

          <div style={{ display: "flex", marginTop: 10 }}>
            {TABS.map((id) => (
              <button
                key={id}
                data-dictionary-tab={id}
                onClick={() => setTab(id)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "none",
                  background: tab === id ? c.text : "transparent",
                  color: tab === id ? c.popup : c.muted,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t(`dictionary.tabs.${id}`)}
              </button>
            ))}
          </div>
        </PopupHeader>

        <PopupBody>
          {state === "loading" && <LoadingLines c={c} />}

          {state === "offline" && (
            <p style={{ fontSize: 12, lineHeight: 1.6, color: c.body, margin: 0 }}>
              {t("dictionary.offline")}
            </p>
          )}

          {state === "ready" && result && tab === "definition" && (
            <>
              {result.senses.length > 0 ? (
                result.senses.slice(0, 3).map((s, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    {result.senses.length > 1 && <div style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{s.pos}{s.tags.length ? ` · ${s.tags.join(", ")}` : ""}</div>}
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: c.text }}>
                      {s.glosses.slice(0, 3).map((g, j) => (
                        <li key={j} dir="auto">{g}</li>
                      ))}
                    </ol>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: c.text, margin: "0 0 10px" }}>
                  {result.gloss_target || result.mtGloss || t("dictionary.noEntry")}
                  {result.dictionary === "downloading" ? (
                    <span style={{ display: "block", fontSize: 11, color: c.muted, marginTop: 4 }}>{t("dictionary.downloading")}</span>
                  ) : (
                    !result.dictionaryAvailable && (
                      <span style={{ display: "block", fontSize: 11, color: c.muted, marginTop: 4 }}>{t("dictionary.machineOnly")}</span>
                    )
                  )}
                </p>
              )}

              <SentenceQuote c={c} sentence={sentence} translation={sentenceTranslation} />

              {result.senses.length > 0 && (result.gloss_target || result.mtGloss) && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
                  <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{t("dictionary.machineGloss")}</span>
                  <span dir="auto" style={{ fontSize: 13, color: c.text }}>{result.gloss_target || result.mtGloss}</span>
                </div>
              )}
            </>
          )}

          {state === "ready" && result && tab === "grammar" && (
            <div>
              <GrammarRow c={c} label={t("dictionary.lemma")} value={result.lemma || "—"} />
              <GrammarRow c={c} label={t("dictionary.partOfSpeech")} value={result.pos ? posLabel(result.pos) : "—"} />
              {Object.entries(result.morph).map(([k, v]) => (
                <GrammarRow key={k} c={c} label={morphLabel(k)} value={morphValue(k, v)} />
              ))}
              {Object.keys(result.morph).length === 0 && (
                <div style={{ fontSize: 12, color: c.muted, paddingTop: 8 }}>{t("dictionary.noInflection")}</div>
              )}
            </div>
          )}

          {tab === "pronunciation" && state !== "loading" && (
            <div>
              <div style={{ fontSize: 22, textAlign: "center", padding: "12px 0 16px", letterSpacing: "1px", color: c.text }}>
                {result?.ipa || word}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <PlayButton c={c} label={t("dictionary.normal")} onClick={() => speakOnce(word, lang, 1, voiceURI)} />
                <PlayButton c={c} label={t("dictionary.slow")} onClick={() => speakOnce(word, lang, 0.55, voiceURI)} />
              </div>
            </div>
          )}
        </PopupBody>
    </PopupFrame>
  );
}

function PlayButton({ c, label, onClick }: { c: ChromeTokens; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: 8, borderRadius: 6, border: `1.5px solid ${c.border}`, background: "transparent", fontSize: 12, color: c.body, cursor: "pointer", fontFamily: "inherit" }}
    >
      <Volume2 size={13} />
      {label}
    </button>
  );
}

function GrammarRow({ c, label, value }: { c: ChromeTokens; label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${c.chip}` }}>
      <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: 12, color: c.text }}>{value}</span>
    </div>
  );
}
