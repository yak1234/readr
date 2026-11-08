import React, { useEffect, useState } from "react";
import { BookMarked, Check, Volume2, X } from "lucide-react";
import type { LookupResult } from "../../shared/types";
import { api } from "../lib/api";
import { speakOnce } from "../lib/speech";
import type { ChromeTokens } from "../lib/theme";

interface Props {
  c: ChromeTokens;
  word: string;
  sentence: string;
  sentenceTranslation: string;
  rect: DOMRect;
  lang: string;
  voiceURI: string;
  onClose: () => void;
  onSave: (r: { word: string; lemma: string; gloss: string }) => Promise<void>;
}

type Tab = "definition" | "grammar" | "pronunciation";

const POS_LABEL: Record<string, string> = {
  NOUN: "nom", PROPN: "nom propre", VERB: "verbe", AUX: "auxiliaire", ADJ: "adjectif", ADV: "adverbe",
  PRON: "pronom", DET: "déterminant", ADP: "préposition", CCONJ: "conjonction", SCONJ: "conjonction",
  NUM: "nombre", INTJ: "interjection", PART: "particule",
};

const MORPH_LABEL: Record<string, [string, Record<string, string>]> = {
  Gender: ["Gender", { Masc: "masculine", Fem: "feminine" }],
  Number: ["Number", { Sing: "singular", Plur: "plural" }],
  Tense: ["Tense", { Pres: "present", Past: "past", Imp: "imperfect", Fut: "future", Pqp: "pluperfect" }],
  Mood: ["Mood", { Ind: "indicative", Sub: "subjunctive", Cnd: "conditional", Imp: "imperative" }],
  Person: ["Person", { "1": "1st", "2": "2nd", "3": "3rd" }],
  VerbForm: ["Form", { Fin: "finite", Inf: "infinitive", Part: "participle", Ger: "gerund" }],
  Voice: ["Voice", { Pass: "passive", Act: "active" }],
  Definite: ["Article", { Def: "definite", Ind: "indefinite" }],
  PronType: ["Pronoun", { Prs: "personal", Rel: "relative", Dem: "demonstrative", Int: "interrogative", Ind: "indefinite" }],
};

const POPUP_W = 320;

export function DictionaryPopup({ c, word, sentence, sentenceTranslation, rect, lang, voiceURI, onClose, onSave }: Props) {
  const [tab, setTab] = useState<Tab>("definition");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    setSaved(false);
    api.lookup(word, sentence).then(
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
  }, [word, sentence]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Place below the word, or above it when there is no room.
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - POPUP_W - 12));
  const below = rect.bottom + 10;
  const placeAbove = below + 340 > window.innerHeight;
  const position: React.CSSProperties = placeAbove ? { bottom: window.innerHeight - rect.top + 10 } : { top: below };

  const firstGloss = result?.senses[0]?.glosses[0] || result?.mtGloss || "";
  const lemma = result?.lemma || word;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={onClose} />
      <div
        role="dialog"
        style={{
          position: "fixed",
          left,
          ...position,
          width: POPUP_W,
          maxHeight: 420,
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
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: c.text, fontFamily: "Georgia, serif", lineHeight: 1.3 }}>{word}</div>
              {result && result.lemma && result.lemma.toLowerCase() !== word.toLowerCase() && (
                <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                  from <span style={{ color: c.text, fontFamily: "Georgia, serif" }}>{result.lemma}</span>
                </div>
              )}
              {result?.ipa && <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>{result.ipa}</div>}
              {result?.pos && (
                <div style={{ display: "inline-block", marginTop: 5, padding: "2px 7px", background: c.chip, borderRadius: 4, fontSize: 10, color: "#8A7B5E", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  {POS_LABEL[result.pos] ?? result.pos.toLowerCase()}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexShrink: 0 }}>
              <IconButton c={c} title="Pronounce" onClick={() => speakOnce(word, lang, 0.9, voiceURI)}>
                <Volume2 size={14} />
              </IconButton>
              <IconButton
                c={c}
                title={saved ? "Saved to vocabulary" : "Save to vocabulary"}
                onClick={async () => {
                  await onSave({ word, lemma, gloss: firstGloss });
                  setSaved(true);
                }}
              >
                {saved ? <Check size={14} /> : <BookMarked size={14} />}
              </IconButton>
              <IconButton c={c} title="Close" onClick={onClose}>
                <X size={14} />
              </IconButton>
            </div>
          </div>

          <div style={{ display: "flex", marginTop: 10 }}>
            {(["definition", "grammar", "pronunciation"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  borderRadius: 4,
                  border: "none",
                  background: tab === t ? c.text : "transparent",
                  color: tab === t ? c.popup : c.muted,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textTransform: "capitalize",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: "14px 16px 16px", overflowY: "auto" }}>
          {state === "loading" && <LoadingLines c={c} />}

          {state === "offline" && (
            <p style={{ fontSize: 12, lineHeight: 1.6, color: c.body, margin: 0 }}>
              The dictionary server isn't reachable yet. If you just launched Readr it may still be loading models; otherwise check the
              status at the bottom of the right panel.
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
                        <li key={j}>{g}</li>
                      ))}
                    </ol>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: c.text, margin: "0 0 10px" }}>
                  {result.mtGloss || "No dictionary entry found."}
                  {!result.dictionaryAvailable && (
                    <span style={{ display: "block", fontSize: 11, color: c.muted, marginTop: 4 }}>Machine gloss — install the Wiktionary dictionary for full entries.</span>
                  )}
                </p>
              )}

              <div style={{ fontSize: 12, fontStyle: "italic", color: c.body, lineHeight: 1.5, marginTop: 4, padding: "8px 10px", background: c.chip, borderRadius: 5, borderLeft: `2px solid ${c.accent}` }}>
                {sentence}
                {sentenceTranslation && <div style={{ fontStyle: "normal", color: c.muted, marginTop: 6 }}>{sentenceTranslation}</div>}
              </div>

              {result.senses.length > 0 && result.mtGloss && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.border}` }}>
                  <span style={{ fontSize: 10, color: c.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Machine gloss</span>
                  <span style={{ fontSize: 13, color: c.text }}>{result.mtGloss}</span>
                </div>
              )}
            </>
          )}

          {state === "ready" && result && tab === "grammar" && (
            <div>
              <GrammarRow c={c} label="Lemma" value={result.lemma || "—"} />
              <GrammarRow c={c} label="Part of speech" value={POS_LABEL[result.pos] ?? (result.pos || "—")} />
              {Object.entries(result.morph).map(([k, v]) => {
                const [label, values] = MORPH_LABEL[k] ?? [k, {}];
                return <GrammarRow key={k} c={c} label={label} value={values[v] ?? v} />;
              })}
              {Object.keys(result.morph).length === 0 && (
                <div style={{ fontSize: 12, color: c.muted, paddingTop: 8 }}>No inflection features for this word.</div>
              )}
            </div>
          )}

          {tab === "pronunciation" && state !== "loading" && (
            <div>
              <div style={{ fontSize: 22, textAlign: "center", padding: "12px 0 16px", letterSpacing: "1px", color: c.text }}>
                {result?.ipa || word}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <PlayButton c={c} label="Normal" onClick={() => speakOnce(word, lang, 1, voiceURI)} />
                <PlayButton c={c} label="Slow" onClick={() => speakOnce(word, lang, 0.55, voiceURI)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function IconButton({ c, title, onClick, children }: { c: ChromeTokens; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: c.muted, borderRadius: 4, display: "flex" }}>
      {children}
    </button>
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

function LoadingLines({ c }: { c: ChromeTokens }) {
  return (
    <div>
      {["90%", "70%", "80%"].map((w, i) => (
        <div key={i} className="readr-shimmer" style={{ height: 10, width: w, background: c.border, borderRadius: 3, marginBottom: 8 }} />
      ))}
    </div>
  );
}
