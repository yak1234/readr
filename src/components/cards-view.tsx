// The cards list: the current language's flashcards, searched by form or translation. A card opens
// in place to show its examples (with their clips), edit its translation and definition, suspend it
// or delete it. Export for Anki writes the cards and their audio to a folder.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Download, Pause, Play, Search, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Card, CardExample, CardsExported } from "../../shared/cards";
import { SERIF, UI_FONT, type ChromeTokens, type ReadingTokens } from "../lib/theme";
import { languageScope } from "../lib/language-scope";
import { intervalLabel, markedSentence, sourceLine } from "../lib/review-format";
import { useCardExamples, useCards } from "../lib/cards-hooks";
import { useCardAudio } from "../lib/card-audio";
import { sentenceSound, wordSound } from "../lib/card-sounds";
import { useReadrSettings } from "../shell/settings-provider";
import { api } from "../lib/api";

interface Props {
  c: ChromeTokens;
  tokens: ReadingTokens;
  lang: string;
  /** All the language's cards (the sidebar's count). */
  total: number;
  /** Opens where an example was met: its article, or the past transcript it was heard in. */
  onOpenSource: (example: CardExample) => void;
}

type ExportState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; result: CardsExported } | { kind: "failed" };

/** What is playing from the open card — its word, or one example's sentence (its clip, or Magpie reading
 * it) — one at a time, through the cards' player (it claims the audio). A second press stops it. */
function useExamplePlayer() {
  const { play, stop, playing } = useCardAudio(useReadrSettings().settings.voiceURI);
  const toggle = (id: string, sound: ReturnType<typeof wordSound>) => (playing === id ? stop() : void play([{ id, sound }]));
  return {
    stop,
    playingId: playing,
    toggleWord: (card: Card) => toggle(`word:${card.id}`, wordSound(card)),
    toggle: (card: Card, e: CardExample) => toggle(e.id, sentenceSound(card, e)),
  };
}

export function CardsView({ c, tokens, lang, total, onOpenSource }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { cards, loaded } = useCards(lang, query);
  const [open, setOpen] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportState>({ kind: "idle" });
  const player = useExamplePlayer();
  const name = languageScope(lang).name;
  // A clip stops when its card closes (or another opens).
  const stopClip = player.stop;
  useEffect(() => stopClip(), [open, stopClip]);

  const runExport = async () => {
    setExported({ kind: "busy" });
    try {
      const result = await api.cardsExport(lang);
      setExported(result ? { kind: "done", result } : { kind: "idle" });
    } catch {
      setExported({ kind: "failed" });
    }
  };

  return (
    <div data-cards style={{ maxWidth: 760, margin: "0 auto", padding: "48px 48px 120px", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 600, letterSpacing: "-0.5px", margin: 0 }}>{t("cards.title")}</h1>
          <div data-cards-total={total} style={{ fontSize: 12, color: tokens.secondary, marginTop: 6 }}>
            {t("cards.total", { count: total, language: name })}
          </div>
        </div>
        <button
          data-cards-export
          onClick={runExport}
          disabled={!total || exported.kind === "busy"}
          className="readr-hover"
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 6, border: `1px solid ${tokens.border}`, background: "transparent", fontSize: 12, color: tokens.text, cursor: total ? "pointer" : "default", opacity: total ? 1 : 0.5, fontFamily: UI_FONT, ["--hover" as string]: c.hover }}
        >
          <Download size={13} strokeWidth={1.8} />
          {t(exported.kind === "busy" ? "cards.exporting" : "cards.export")}
        </button>
      </div>

      {(exported.kind === "done" || exported.kind === "failed") && (
        <div data-cards-exported role="status" style={{ fontSize: 12, lineHeight: 1.55, color: tokens.secondary, background: tokens.sentenceHover, borderRadius: 6, padding: "9px 12px", marginBottom: 18 }}>
          {exported.kind === "failed"
            ? t("cards.exportFailed")
            : [t("cards.exported", { count: exported.result.cards }), exported.result.media ? t("cards.exportedMedia") : ""].filter(Boolean).join(" ")}
        </div>
      )}

      {total > 0 && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, border: `1px solid ${tokens.border}`, marginBottom: 8, color: tokens.secondary }}>
          <Search size={14} strokeWidth={1.8} />
          <input
            data-cards-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("cards.search")}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 13, color: tokens.text, fontFamily: UI_FONT }}
          />
        </label>
      )}

      {loaded && total === 0 && (
        <p data-cards-empty style={{ fontSize: 14, color: tokens.secondary, lineHeight: 1.6, maxWidth: 520 }}>
          {t("cards.empty", { language: name })}
        </p>
      )}
      {loaded && total > 0 && cards.length === 0 && <p style={{ fontSize: 13, color: tokens.secondary }}>{t("cards.noMatch", { query: query.trim() })}</p>}

      <div>
        {cards.map((card) => (
          <CardRow
            key={card.id}
            c={c}
            tokens={tokens}
            card={card}
            open={open === card.id}
            onToggle={() => setOpen((o) => (o === card.id ? null : card.id))}
            player={player}
            onOpenSource={onOpenSource}
          />
        ))}
      </div>
    </div>
  );
}

/** Where a card stands: suspended, new, due, or when it comes back. */
function cardStatus(t: TFunction, card: Card, now: number): string {
  if (card.suspended) return t("cards.suspended");
  if (card.isNew) return t("cards.new");
  return card.due <= now ? t("cards.due") : t("cards.in", { interval: intervalLabel(card.due - now) });
}

function CardRow({ c, tokens, card, open, onToggle, player, onOpenSource }: {
  c: ChromeTokens;
  tokens: ReadingTokens;
  card: Card;
  open: boolean;
  onToggle: () => void;
  player: ReturnType<typeof useExamplePlayer>;
  onOpenSource: (example: CardExample) => void;
}) {
  const { t } = useTranslation();
  const content = languageScope(card.lang);
  return (
    <div data-card={card.id} data-open={open ? "" : undefined} data-suspended={card.suspended ? "" : undefined} style={{ borderBottom: `1px solid ${tokens.border}` }}>
      <button
        data-card-toggle
        onClick={onToggle}
        aria-expanded={open}
        className="readr-hover"
        style={{ width: "100%", display: "flex", alignItems: "baseline", gap: 14, padding: "14px 10px", margin: "0 -10px", boxSizing: "content-box", background: "none", border: "none", borderRadius: 6, cursor: "pointer", textAlign: "start", color: tokens.text, fontFamily: UI_FONT, ["--hover" as string]: c.hover }}
      >
        <span data-card-form lang={card.lang} dir={content.dir} style={{ fontFamily: content.contentFont, fontSize: Math.round(19 * content.contentScale), fontWeight: 600, opacity: card.suspended ? 0.5 : 1, flexShrink: 0 }}>
          {card.form}
        </span>
        <span data-card-translation dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 13, color: card.translation ? tokens.text : tokens.secondary, fontStyle: card.translation ? "normal" : "italic", opacity: card.suspended ? 0.5 : 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.translation || t("cards.noTranslation")}
        </span>
        <span data-card-status style={{ fontSize: 11, color: tokens.secondary, letterSpacing: "0.02em", flexShrink: 0 }}>{cardStatus(t, card, Date.now())}</span>
        <ChevronDown size={14} strokeWidth={1.8} style={{ color: tokens.secondary, flexShrink: 0, alignSelf: "center", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {open && <CardDetails c={c} tokens={tokens} card={card} player={player} onOpenSource={onOpenSource} />}
    </div>
  );
}

function CardDetails({ c, tokens, card, player, onOpenSource }: {
  c: ChromeTokens;
  tokens: ReadingTokens;
  card: Card;
  player: ReturnType<typeof useExamplePlayer>;
  onOpenSource: (example: CardExample) => void;
}) {
  const { t } = useTranslation();
  const examples = useCardExamples(card.id);
  const [confirming, setConfirming] = useState(false);
  const save = (patch: { translation?: string; definition?: string | null }) => api.cardsEdit(card.id, patch);
  const action: React.CSSProperties = { padding: "6px 11px", borderRadius: 6, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, fontSize: 12, cursor: "pointer", fontFamily: UI_FONT, ["--hover" as string]: c.hover };

  return (
    <div data-card-details className="readr-arrive" style={{ padding: "2px 0 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <EditableField tokens={tokens} label={t("cards.translation")} value={card.translation} placeholder={t("cards.addTranslation")} onSave={(v) => save({ translation: v })} name="translation" />
        <EditableField tokens={tokens} label={t("cards.definition")} value={card.definition ?? ""} placeholder={t("cards.addDefinition")} onSave={(v) => save({ definition: v || null })} name="definition" />
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: tokens.secondary, marginBottom: 6 }}>
          {t("cards.example", { count: examples.length })}
        </div>
        {examples.map((e) => (
          <Example key={e.id} c={c} tokens={tokens} card={card} example={e} playing={player.playingId === e.id} onPlay={() => player.toggle(card, e)} onOpenSource={onOpenSource} />
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {confirming ? (
          <>
            <span style={{ fontSize: 12, color: tokens.text, marginRight: 4 }}>{t("cards.confirmDelete")}</span>
            <button data-card-delete-confirm onClick={() => void api.cardsDelete(card.id).catch(() => undefined)} className="readr-hover" style={{ ...action, borderColor: tokens.text, background: tokens.text, color: tokens.bg }}>
              {t("cards.deleteCard")}
            </button>
            <button data-card-delete-cancel onClick={() => setConfirming(false)} className="readr-hover" style={action}>
              {t("cards.cancel")}
            </button>
          </>
        ) : (
          <>
            {wordSound(card) && (
              <button data-card-say-word data-playing={player.playingId === `word:${card.id}` ? "" : undefined} onClick={() => player.toggleWord(card)} className="readr-hover" style={{ ...action, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Volume2 size={12} strokeWidth={1.8} />
                {t("cards.sayWord")}
              </button>
            )}
            <button data-card-suspend onClick={() => void api.cardsSuspend(card.id, !card.suspended).catch(() => undefined)} className="readr-hover" style={action}>
              {t(card.suspended ? "cards.unsuspend" : "cards.suspend")}
            </button>
            <button data-card-delete onClick={() => setConfirming(true)} className="readr-hover" style={action}>
              {t("cards.delete")}
            </button>
            {card.suspended && <span style={{ fontSize: 11, color: tokens.secondary }}>{t("cards.suspendedNote")}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function Example({ c, tokens, card, example, playing, onPlay, onOpenSource }: {
  c: ChromeTokens;
  tokens: ReadingTokens;
  card: Card;
  example: CardExample;
  playing: boolean;
  onPlay: () => void;
  onOpenSource: (example: CardExample) => void;
}) {
  const { t } = useTranslation();
  const content = languageScope(card.lang);
  const [before, phrase, after] = markedSentence(example.sentence, example.span, card.form);
  const heard = example.sourceKind !== "article";
  const canOpen = Boolean(example.liveSessionId || example.sourceUrl);
  return (
    // The row and its English line keep the chrome's order; only the sentence takes its own direction.
    <div data-card-example={example.id} style={{ display: "flex", gap: 10, padding: "8px 0" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p lang={card.lang} dir={content.dir} style={{ fontFamily: content.contentFont, fontSize: Math.round(15 * content.contentScale), lineHeight: 1.6, margin: 0, color: tokens.text }}>
          {before}
          {phrase && <mark style={{ background: tokens.snapHighlight, color: tokens.text, borderRadius: 3, padding: "1px 2px" }}>{phrase}</mark>}
          {after}
        </p>
        {example.sentenceTranslation && (
          <p dir="auto" style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 13, lineHeight: 1.5, color: tokens.secondary, margin: "3px 0 0" }}>
            {example.sentenceTranslation}
          </p>
        )}
        <div dir="ltr" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 5, fontSize: 11, color: tokens.secondary }}>
          {canOpen ? (
            <button data-card-source onClick={() => onOpenSource(example)} className="readr-hover" title={example.sourceTitle ?? undefined} style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "none", border: "none", padding: "2px 4px", margin: "0 -4px", borderRadius: 4, cursor: "pointer", color: tokens.secondary, fontSize: 11, fontFamily: UI_FONT, ["--hover" as string]: c.hover }}>
              {sourceLine(example, new Date())}
              <ArrowUpRight size={11} strokeWidth={1.8} />
            </button>
          ) : (
            <span>{sourceLine(example, new Date())}</span>
          )}
          {heard && !example.clip && <span data-card-no-audio style={{ opacity: 0.8 }}>{t("notices.noAudio")}</span>}
        </div>
      </div>
      {sentenceSound(card, example) && (
        <button
          data-card-play
          data-playing={playing ? "" : undefined}
          title={t(playing ? "cards.stop" : example.clip ? "cards.playClip" : "cards.readSentence")}
          onClick={onPlay}
          style={{ flexShrink: 0, marginTop: 2, width: 28, height: 28, borderRadius: 14, border: `1px solid ${tokens.border}`, background: playing ? c.accentSoft : "transparent", color: playing ? tokens.text : tokens.secondary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          {playing ? <Pause size={11} strokeWidth={2} /> : <Play size={11} strokeWidth={2} style={{ marginLeft: 2 }} />}
        </button>
      )}
    </div>
  );
}

/**
 * A labelled field saved when it loses focus (Enter too; Shift+Enter is a new line), and when the
 * card closes while it is being edited. Escape puts back what was saved. A change arriving from
 * elsewhere (a translation filled in) shows only while the field isn't being edited. A save that
 * fails puts the saved text back and says so.
 */
function EditableField({ tokens, label, value, placeholder, onSave, name }: { tokens: ReadingTokens; label: string; value: string; placeholder: string; onSave: (v: string) => Promise<void>; name: string }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const [failed, setFailed] = useState(false);
  const dirty = useRef(false);
  const focused = useRef(false);
  const latest = useRef({ draft, value, onSave });
  latest.current = { draft, value, onSave };
  useEffect(() => {
    if (!dirty.current && !focused.current) setDraft(value);
  }, [value]);
  const commit = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    const { draft: text, value: saved, onSave: save } = latest.current;
    const v = text.trim();
    if (v === saved.trim()) return;
    setFailed(false);
    save(v).catch(() => {
      setDraft(saved);
      setFailed(true);
    });
  }, []);
  useEffect(() => () => commit(), [commit]); // the card closed mid-edit
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: tokens.secondary }}>{label}</span>
      <textarea
        data-card-field={name}
        dir="auto"
        rows={2}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          dirty.current = true;
          setFailed(false);
          setDraft(e.target.value);
        }}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          // Edited: save it. Not edited: show what is saved now (it may have changed meanwhile).
          if (dirty.current) commit();
          else setDraft(latest.current.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            dirty.current = false;
            setDraft(value);
            e.currentTarget.blur();
          }
        }}
        style={{ resize: "vertical", minHeight: 38, padding: "7px 9px", borderRadius: 6, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, fontSize: 13, lineHeight: 1.45, fontFamily: UI_FONT, outline: "none" }}
      />
      {failed && (
        <span data-card-field-failed role="status" style={{ fontSize: 11, color: tokens.secondary }}>
          {t("cards.saveFailed")}
        </span>
      )}
    </label>
  );
}
