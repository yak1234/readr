// How many cards wait for review in a language, kept current: refetched when cards change, when a
// learning card comes due later today, and when the study day turns over at 4 AM.

import { useCallback, useEffect, useState } from "react";
import { studyDayEnd, type CardCounts } from "../../shared/cards";
import { api } from "./api";

const NONE: CardCounts = { due: 0, new: 0, nextDueToday: null };
/** Timers further out than this are re-armed (setTimeout's limit is ~24.8 days; a day is plenty). */
const MAX_WAIT = 24 * 60 * 60 * 1000;

export function useReviewCounts(lang: string, newPerDay: number): { counts: CardCounts; refresh: () => void } {
  const [counts, setCounts] = useState<CardCounts>(NONE);
  const refresh = useCallback(() => {
    if (!lang) return setCounts(NONE);
    api.cardsCounts(lang, newPerDay).then(setCounts, () => undefined);
  }, [lang, newPerDay]);

  useEffect(refresh, [refresh]);
  useEffect(() => api.onCardsChanged(refresh), [refresh]);
  useEffect(() => {
    const now = Date.now();
    const next = Math.min(counts.nextDueToday ?? Infinity, studyDayEnd(new Date(now)));
    const timer = window.setTimeout(refresh, Math.min(MAX_WAIT, Math.max(1000, next - now + 500)));
    return () => window.clearTimeout(timer);
  }, [counts, refresh]);

  return { counts, refresh };
}

/** What the sidebar's Review badge counts: due reviews and today's allowance of new cards. */
export const toReview = (c: CardCounts) => c.due + c.new;
