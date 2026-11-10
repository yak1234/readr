// Reviewing flashcards: one card at a time, the word large, the sentence it was met in beneath it.
// A card says itself as it arrives: the word, then the sentence (its clip, or Magpie reading it); each has
// its own button, and R plays both again. Space shows the answer, 1–4 rate it. The flow is
// src/lib/review-session.ts; the data and keys are src/lib/review-hooks.ts, the sound src/lib/card-audio.ts;
// this file only lays them out.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Play, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChromeKey } from "../i18n";
import type { Card, CardCounts, CardExample, IntervalPreview, ReviewRating } from "../../shared/cards";
import { SERIF, UI_FONT, type ChromeTokens, type ReadingTokens } from "../lib/theme";
import { languageScope } from "../lib/language-scope";
import { backIn, intervalLabel, markedSentence, sourceLine } from "../lib/review-format";
import { useActivityToday, useCardDetails, useReview, useReviewKeys } from "../lib/review-hooks";
import { toReview } from "../lib/review-counts";
import { useCardAudio } from "../lib/card-audio";
import { sentenceSound, wordSound, type CardPart } from "../lib/card-sounds";
import { useReadrSettings } from "../shell/settings-provider";

interface Props {
  c: ChromeTokens;
  tokens: ReadingTokens;
  lang: string;
  newPerDay: number;
  counts: CardCounts;
  /** Opens where an example was met: its article, or the past transcript (at its sentence) it was heard in. */
  onOpenSource: (example: CardExample) => void;
}

const RATINGS: { rating: ReviewRating; label: ChromeKey }[] = [
  { rating: 1, label: "review.again" },
  { rating: 2, label: "review.hard" },
  { rating: 3, label: "review.good" },
  { rating: 4, label: "review.easy" },
];

export function ReviewView({ c, tokens, lang, newPerDay, counts, onOpenSource }: Props) {
  const { t } = useTranslation();
  const { session, show, grade } = useReview(lang, newPerDay, toReview(counts));
  const card = session?.current ?? null;
  const details = useCardDetails(card, session?.queue[1] ?? null);
  const example = details?.examples[0] ?? null;
  const { play, playing } = useCardAudio(useReadrSettings().settings.voiceURI);
  // Known once the card's examples are: the word, then the sentence.
  const parts = useMemo<CardPart[] | null>(
    () => (card && details ? [{ id: "word", sound: wordSound(card) }, { id: "sentence", sound: example ? sentenceSound(card, example) : null }] : null),
    [card, details, example],
  );
  // Each time a card comes up (an Again card coming back too), it says itself once.
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!card || !parts) return;
    const shown = `${card.id}@${card.due}`;
    if (said.current === shown) return;
    said.current = shown;
    void play(parts);
  }, [card, parts, play]);
  const today = useActivityToday(session?.reviewed ?? 0);
  useReviewKeys({ reveal: show, rate: grade, replay: () => parts && void play(parts) });

  return (
    <div data-review style={{ minHeight: "100%", display: "flex", flexDirection: "column", fontFamily: UI_FONT, color: tokens.text }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "9vh 48px 32px" }}>
        {!session ? null : card ? (
          <>
            <Progress tokens={tokens} remaining={session.remaining} />
            <CardFace key={`${card.id}@${card.due}`} c={c} tokens={tokens} card={card} example={example} revealed={session.revealed} parts={parts} playing={playing} onPlay={(part) => void play([part])} onOpenSource={onOpenSource} />
            <div style={{ marginTop: 44, width: "100%", maxWidth: 560 }}>
              {session.revealed ? (
                <>
                  <RatingButtons c={c} tokens={tokens} preview={details?.preview ?? null} onRate={grade} />
                  {session.failed && (
                    <div data-review-failed role="status" style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: tokens.secondary }}>
                      {t("review.saveFailed")}
                    </div>
                  )}
                </>
              ) : (
                <ShowAnswer c={c} tokens={tokens} onClick={show} />
              )}
            </div>
          </>
        ) : (
          <Empty tokens={tokens} counts={counts} reviewed={session.reviewed} />
        )}
      </div>
      <footer data-review-today style={{ padding: "14px 0 22px", textAlign: "center", fontSize: 12, color: tokens.secondary, letterSpacing: "0.01em" }}>
        {today && t("review.today", { count: today.reviews, minutes: today.listenMinutes })}
      </footer>
    </div>
  );
}

/** Cards left in this sitting, Again cards coming back included. The sidebar's badge differs on purpose:
 * it counts what the database says is due now (plus today's new cards), so a re-queued Again card
 * that isn't due yet shows here but not there. */
function Progress({ tokens, remaining }: { tokens: ReadingTokens; remaining: number }) {
  const { t } = useTranslation();
  return (
    <div data-review-remaining={remaining} style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", color: tokens.secondary, opacity: 0.8, marginBottom: 40 }}>
      {t("review.toGo", { count: remaining })}
    </div>
  );
}

function CardFace({ c, tokens, card, example, revealed, parts, playing, onPlay, onOpenSource }: {
  c: ChromeTokens;
  tokens: ReadingTokens;
  card: Card;
  example: CardExample | null;
  revealed: boolean;
  /** The word and the sentence, once known. */
  parts: CardPart[] | null;
  /** The part sounding now. */
  playing: string | null;
  onPlay: (part: CardPart) => void;
  onOpenSource: (example: CardExample) => void;
}) {
  const { t } = useTranslation();
  const content = languageScope(card.lang);
  const font = content.contentFont;
  const scale = content.contentScale;
  const [before, phrase, after] = example ? markedSentence(example.sentence, example.span, card.form) : ["", "", ""];
  const word = parts?.find((p) => p.id === "word" && p.sound);
  const sentence = parts?.find((p) => p.id === "sentence" && p.sound);
  return (
    <article data-review-card={card.id} data-revealed={revealed ? "" : undefined} style={{ width: "100%", maxWidth: 640, textAlign: "center" }}>
      {/* The word takes its own direction; the row (word, then its button) keeps the chrome's. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
        <h1 data-review-form lang={card.lang} dir={content.dir} style={{ fontFamily: font, fontSize: Math.round(48 * scale), fontWeight: 400, lineHeight: 1.2, letterSpacing: scale > 1 ? 0 : "-0.01em", margin: 0, color: tokens.text }}>
          {card.form}
        </h1>
        {word && <SoundButton c={c} tokens={tokens} name="data-review-say-word" title={t("review.sayWord")} playing={playing === "word"} onClick={() => onPlay(word)} />}
      </div>

      {example && (
        // The sentence takes its own direction; the row (sentence, then the play button) keeps the chrome's.
        <div style={{ marginTop: 30, display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 12 }}>
          <p data-review-sentence lang={card.lang} dir={content.dir} style={{ fontFamily: font, fontSize: Math.round(20 * scale), lineHeight: 1.65, color: tokens.secondary, margin: 0, maxWidth: 560 }}>
            {before}
            {phrase && <mark data-review-phrase style={{ background: tokens.snapHighlight, color: tokens.text, borderRadius: 3, padding: "1px 2px", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>{phrase}</mark>}
            {after}
          </p>
          {sentence && <SoundButton c={c} tokens={tokens} name="data-review-play" title={t("review.playSentence")} playing={playing === "sentence"} onClick={() => onPlay(sentence)} style={{ marginTop: 4 }} />}
        </div>
      )}

      {revealed && (
        <div data-review-back className="readr-arrive" style={{ marginTop: 34, paddingTop: 30, borderTop: `1px solid ${tokens.border}` }}>
          <div data-review-translation dir="auto" style={{ fontFamily: SERIF, fontSize: 26, lineHeight: 1.35, color: tokens.text }}>
            {card.translation || <span style={{ color: tokens.secondary, fontStyle: "italic", fontSize: 18 }}>{t("review.noTranslation")}</span>}
          </div>
          {card.definition && (
            <div data-review-definition dir="auto" style={{ marginTop: 10, fontSize: 14, lineHeight: 1.55, color: tokens.secondary }}>
              {card.definition}
            </div>
          )}
          {example?.sentenceTranslation && (
            <p data-review-sentence-translation dir="auto" style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 16, lineHeight: 1.6, color: tokens.secondary, margin: "22px auto 0", maxWidth: 540 }}>
              {example.sentenceTranslation}
            </p>
          )}
          {example && <SourceLine c={c} tokens={tokens} example={example} onOpen={onOpenSource} />}
        </div>
      )}
    </article>
  );
}

/** A round play button that shows a speaker while its sound plays. `name` is its data attribute. */
function SoundButton({ c, tokens, name, title, playing, onClick, style }: {
  c: ChromeTokens;
  tokens: ReadingTokens;
  name: string;
  title: string;
  playing: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      {...{ [name]: "" }}
      data-playing={playing ? "" : undefined}
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 15, border: `1px solid ${tokens.border}`, background: playing ? c.accentSoft : "transparent", color: playing ? tokens.text : tokens.secondary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "background 0.2s", ...style }}
    >
      {playing ? <Volume2 size={13} strokeWidth={1.8} /> : <Play size={12} strokeWidth={2} style={{ marginLeft: 2 }} />}
    </button>
  );
}

function SourceLine({ c, tokens, example, onOpen }: { c: ChromeTokens; tokens: ReadingTokens; example: CardExample; onOpen: (example: CardExample) => void }) {
  const text = sourceLine(example, new Date());
  const style: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, marginTop: 20, fontSize: 12, color: tokens.secondary, letterSpacing: "0.01em" };
  // Heard on radio or TV: the past transcript, at that sentence; read: the article.
  if (!example.liveSessionId && !example.sourceUrl) return <div data-review-source style={style}>{text}</div>;
  return (
    <button
      data-review-source
      data-review-session={example.liveSessionId ?? undefined}
      title={example.sourceTitle ?? undefined}
      onClick={() => onOpen(example)}
      className="readr-hover"
      style={{ ...style, background: "none", border: "none", borderRadius: 4, padding: "3px 6px", cursor: "pointer", fontFamily: UI_FONT, ["--hover" as string]: c.hover }}
    >
      {text}
      <ArrowUpRight size={12} strokeWidth={1.8} />
    </button>
  );
}

function ShowAnswer({ c, tokens, onClick }: { c: ChromeTokens; tokens: ReadingTokens; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <button
        data-review-show
        onClick={onClick}
        className="readr-hover"
        style={{ padding: "10px 28px", borderRadius: 8, border: `1px solid ${tokens.border}`, background: "transparent", color: tokens.text, fontSize: 13, fontFamily: UI_FONT, cursor: "pointer", ["--hover" as string]: c.hover }}
      >
        {t("review.showAnswer")}
      </button>
      <Kbd tokens={tokens}>{t("review.space")}</Kbd>
    </div>
  );
}

function RatingButtons({ c, tokens, preview, onRate }: { c: ChromeTokens; tokens: ReadingTokens; preview: IntervalPreview | null; onRate: (r: ReviewRating) => void }) {
  const { t } = useTranslation();
  return (
    <div className="readr-arrive" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
      {RATINGS.map(({ rating, label }) => (
        <button
          key={rating}
          data-rate={rating}
          onClick={() => onRate(rating)}
          className="readr-hover"
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "11px 6px 9px", borderRadius: 8, border: `1px solid ${tokens.border}`, background: c.popup, color: tokens.text, fontFamily: UI_FONT, cursor: "pointer", ["--hover" as string]: c.hover }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>{t(label)}</span>
          <span data-interval style={{ fontSize: 11, color: tokens.secondary, minHeight: 15 }}>{preview ? intervalLabel(preview[rating]) : " "}</span>
          <span style={{ fontSize: 10, color: c.muted, marginTop: 2 }}>{rating}</span>
        </button>
      ))}
    </div>
  );
}

function Empty({ tokens, counts, reviewed }: { tokens: ReadingTokens; counts: CardCounts; reviewed: number }) {
  const { t } = useTranslation();
  const now = useMinuteClock();
  const waitMs = counts.nextDueToday === null ? null : counts.nextDueToday - now;
  return (
    <div data-review-empty style={{ marginTop: "12vh", textAlign: "center", maxWidth: 420 }}>
      {reviewed > 0 && <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", color: tokens.secondary, marginBottom: 18 }}>{t("review.reviewed", { count: reviewed })}</div>}
      {waitMs !== null ? (
        <>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: tokens.text }}>{backIn(waitMs)}</div>
          <div style={{ marginTop: 10, fontSize: 13, color: tokens.secondary, lineHeight: 1.6 }}>{t("review.laterToday")}</div>
        </>
      ) : (
        <div style={{ fontFamily: SERIF, fontSize: 24, lineHeight: 1.45, color: tokens.text }}>{t("review.nothingDue")}</div>
      )}
    </div>
  );
}

function Kbd({ tokens, children }: { tokens: ReadingTokens; children: React.ReactNode }) {
  return <span style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: tokens.secondary, opacity: 0.75 }}>{children}</span>;
}

/** Now, updated every half minute (for "Back in N min"). */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
