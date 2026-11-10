// The cards list's connections to the main process: a language's cards (searched), one card's
// examples, and the sentences heard on radio or TV that cards were made from. Each refetches
// whenever a card is added, changed or removed, from either window.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, CardExample } from "../../shared/cards";
import { api } from "./api";

/** Runs `load` now and whenever cards change; only the latest answer is kept. */
function useCardsQuery<T>(load: (() => Promise<T>) | null, empty: T): { value: T; loaded: boolean; refresh: () => void } {
  const [state, setState] = useState<{ value: T; loaded: boolean }>({ value: empty, loaded: false });
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const n = ++latest.current;
    if (!load) return setState({ value: empty, loaded: false });
    load().then(
      (value) => n === latest.current && setState({ value, loaded: true }),
      () => n === latest.current && setState((s) => ({ ...s, loaded: true })),
    );
    // `empty` is a constant for each caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);
  useEffect(refresh, [refresh]);
  useEffect(() => api.onCardsChanged(refresh), [refresh]);
  return { ...state, refresh };
}

const NO_CARDS: Card[] = [];
const NO_EXAMPLES: CardExample[] = [];
const NO_SENTENCES: string[] = [];

/** A language's cards, A to Z; `query` keeps those whose form or translation contains it. */
export function useCards(lang: string, query = "") {
  const load = useCallback(() => api.cardsList(lang, query.trim() || undefined), [lang, query]);
  const { value, loaded, refresh } = useCardsQuery(lang ? load : null, NO_CARDS);
  return { cards: value, loaded, refresh };
}

/** One card's examples, newest first, with their clips; nothing while `cardId` is null. */
export function useCardExamples(cardId: string | null) {
  const load = useCallback(() => api.cardsExamples(cardId ?? ""), [cardId]);
  return useCardsQuery(cardId ? load : null, NO_EXAMPLES).value;
}

/** The sentences heard on radio or TV that cards were made from. */
export function useLiveExampleSentences(): string[] {
  const load = useCallback(() => api.cardsLiveSentences(), []);
  return useCardsQuery(load, NO_SENTENCES).value;
}

/** What a language's cards mark as saved where words are shown: forms, and one-word phrases as written. */
export function useSavedSurfaces(lang: string): string[] {
  const load = useCallback(() => api.cardsSavedSurfaces(lang), [lang]);
  return useCardsQuery(lang ? load : null, NO_SENTENCES).value;
}
