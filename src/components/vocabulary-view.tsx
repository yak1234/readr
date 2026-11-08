import React from "react";
import { Download, Trash2, Volume2 } from "lucide-react";
import type { VocabEntry } from "../../shared/types";
import type { ChromeTokens, ReadingTokens } from "../lib/theme";
import { speakOnce } from "../lib/speech";

interface Props {
  c: ChromeTokens;
  tokens: ReadingTokens;
  vocab: VocabEntry[];
  voiceURI: string;
  onRemove: (id: string) => void;
  onExport: () => void;
  onOpen: (url: string) => void;
}

export function VocabularyView({ c, tokens, vocab, voiceURI, onRemove, onExport, onOpen }: Props) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 48px 120px", fontFamily: "'Inter', system-ui, sans-serif", color: tokens.text }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: 32, fontWeight: 600, letterSpacing: "-0.5px", margin: 0 }}>Vocabulary</h1>
          <div style={{ fontSize: 12, color: tokens.secondary, marginTop: 6 }}>
            {vocab.length} {vocab.length === 1 ? "word" : "words"} saved from your reading
          </div>
        </div>
        <button
          onClick={onExport}
          disabled={!vocab.length}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 6, border: `1.5px solid ${c.border}`, background: "transparent", fontSize: 12, color: tokens.text, cursor: vocab.length ? "pointer" : "default", opacity: vocab.length ? 1 : 0.5, fontFamily: "inherit" }}
        >
          <Download size={13} />
          Export for Anki
        </button>
      </div>

      {vocab.length === 0 && (
        <p style={{ fontSize: 14, color: tokens.secondary, lineHeight: 1.6 }}>
          Click any word while reading and press the bookmark in the popup to save it here, together with the sentence you found it in.
        </p>
      )}

      {[...vocab].reverse().map((v) => (
        <div key={v.id} style={{ padding: "16px 0", borderBottom: `1px solid ${tokens.border}`, display: "flex", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 600 }}>{v.word}</span>
              {v.lemma && v.lemma.toLowerCase() !== v.word.toLowerCase() && <span style={{ fontSize: 12, color: tokens.secondary }}>{v.lemma}</span>}
              <span style={{ fontSize: 13, color: tokens.text }}>— {v.gloss || "…"}</span>
            </div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 14, fontStyle: "italic", color: tokens.secondary, lineHeight: 1.55, marginTop: 6 }}>{v.sentence}</div>
            {v.sentenceTranslation && <div style={{ fontSize: 12, color: tokens.secondary, opacity: 0.8, marginTop: 4 }}>{v.sentenceTranslation}</div>}
            <button onClick={() => onOpen(v.articleUrl)} style={{ background: "none", border: "none", padding: 0, marginTop: 6, fontSize: 11, color: c.accent, cursor: "pointer", fontFamily: "inherit" }}>
              {v.articleTitle}
            </button>
          </div>
          <div style={{ display: "flex", gap: 2, alignItems: "flex-start" }}>
            <button title="Pronounce" onClick={() => speakOnce(v.word, "fr", 0.9, voiceURI)} style={{ background: "none", border: "none", color: tokens.secondary, cursor: "pointer", padding: 4 }}>
              <Volume2 size={14} />
            </button>
            <button title="Remove" onClick={() => onRemove(v.id)} style={{ background: "none", border: "none", color: tokens.secondary, cursor: "pointer", padding: 4 }}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
