// The review screen's connections to the outside: the queue and each card's examples and interval
// preview from the main process, the keyboard, and today's activity. (Its sound is src/lib/card-audio.ts.)

import { useCallback, useEffect, useRef, useState } from "react";
import { studyDayEnd, type ActivityToday, type Card, type CardExample, type IntervalPreview, type ReviewRating } from "../../shared/cards";
import { api } from "./api";
import { commit, fail, rate, reveal, startReview, type ReviewSession } from "./review-session";

/** The sitting for `lang`: loaded on open, and again whenever it runs dry while `waiting` says cards are due. */
export function useReview(lang: string, newPerDay: number, waiting: number) {
  const [session, setSession] = useState<ReviewSession<Card> | null>(null);
  // The latest state, read and written synchronously: two key presses before React redraws must
  // still see each other (the second finds the first pending and is ignored).
  const latest = useRef<ReviewSession<Card> | null>(null);
  const apply = useCallback((step: (s: ReviewSession<Card>) => ReviewSession<Card>) => {
    const s = latest.current;
    if (!s) return s;
    const next = step(s);
    if (next !== s) setSession((latest.current = next));
    return next;
  }, []);
  const load = useCallback(() => {
    const begin = (cards: Card[]) => setSession((latest.current = startReview(cards)));
    api.cardsDue(lang, newPerDay).then(begin, () => begin([]));
  }, [lang, newPerDay]);
  useEffect(load, [load]);
  // Ran dry: reload if cards have come due (a learning card's wait is over). Keyed on emptiness, not the
  // session itself, so a reload that finds nothing doesn't try again until the count changes.
  const empty = session !== null && !session.current;
  useEffect(() => {
    if (empty && waiting > 0) load();
  }, [empty, waiting, load]);

  const show = useCallback(() => void apply(reveal), [apply]);
  const grade = useCallback(
    async (rating: ReviewRating) => {
      const before = latest.current;
      const sent = apply((s) => rate(s, rating));
      const pending = sent !== before ? sent?.pending : null;
      if (!pending || !sent?.current) return;
      try {
        const updated = await api.cardsReview(sent.current.id, rating);
        apply((s) => commit(s, pending.key, updated, Date.now()));
      } catch {
        apply((s) => fail(s, pending.key));
      }
    },
    [apply],
  );
  return { session, show, grade };
}

export interface CardDetails {
  examples: CardExample[];
  preview: IntervalPreview | null;
}

/** The current card's examples and interval preview; the next card's are fetched ahead so it shows at once. */
export function useCardDetails(card: Card | null, next: Card | null): CardDetails | null {
  const cache = useRef(new Map<string, Promise<CardDetails>>());
  const [details, setDetails] = useState<{ key: string; value: CardDetails } | null>(null);
  // A card's due time changes when it is rated, and with it the preview: the key includes it.
  const keyOf = (c: Card) => `${c.id}@${c.due}`;
  const fetch = useCallback((c: Card) => {
    const key = keyOf(c);
    let p = cache.current.get(key);
    if (!p) {
      p = Promise.all([api.cardsExamples(c.id), api.cardsPreviewIntervals(c.id)]).then(([examples, preview]) => ({ examples, preview }));
      p.catch(() => cache.current.delete(key));
      cache.current.set(key, p);
    }
    return p;
  }, []);
  useEffect(() => {
    if (!card) return;
    let live = true;
    const key = keyOf(card);
    fetch(card).then((value) => live && setDetails({ key, value }), () => live && setDetails({ key, value: { examples: [], preview: null } }));
    if (next) void fetch(next).catch(() => undefined);
    // Only the cards still in the sitting are kept (clips can be large).
    for (const k of cache.current.keys()) if (k !== key && (!next || k !== keyOf(next))) cache.current.delete(k);
    return () => {
      live = false;
    };
  }, [card, next, fetch]);
  return card && details?.key === keyOf(card) ? details.value : null;
}

/** Space reveals, 1–4 rate, R replays. Keys typed into a field, or with a modifier, are left alone. */
export function useReviewKeys(on: { reveal: () => void; rate: (r: ReviewRating) => void; replay: () => void }) {
  const handlers = useRef(on);
  handlers.current = on;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === " ") {
        e.preventDefault(); // not a page scroll, nor a click on the focused button
        handlers.current.reveal();
      } else if (e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        handlers.current.rate(Number(e.key) as ReviewRating);
      } else if (e.key === "r" || e.key === "R") handlers.current.replay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Today's reviews and listening: refreshed after each review, when cards change, when a live session
 * ends, and when the study day turns over at 4 AM. */
export function useActivityToday(reviewed: number): ActivityToday | null {
  const [today, setToday] = useState<ActivityToday | null>(null);
  const refresh = useCallback(() => void api.activityToday().then(setToday, () => undefined), []);
  useEffect(refresh, [refresh, reviewed]);
  useEffect(() => api.onCardsChanged(refresh), [refresh]);
  useEffect(() => api.onActivityChanged(refresh), [refresh]);
  useEffect(() => {
    const timer = window.setTimeout(refresh, studyDayEnd(new Date()) - Date.now() + 1000);
    return () => window.clearTimeout(timer);
  }, [today, refresh]);
  return today;
}
