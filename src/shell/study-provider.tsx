// The language's flashcards as the sidebar and the study pages count them: how many cards, and how many to
// review now (due reviews and today's new ones). Held once so the badges and the pages agree.

import React, { createContext, useContext, useMemo } from "react";
import type { CardCounts } from "../../shared/cards";
import { useCards } from "../lib/cards-hooks";
import { useReviewCounts } from "../lib/review-counts";
import { useLanguage } from "./language-provider";
import { useLibrary } from "./library-provider";
import { useReadrSettings } from "./settings-provider";

export interface StudyValue {
  cardCount: number;
  counts: CardCounts;
}

const StudyContext = createContext<StudyValue | null>(null);

export function StudyProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useReadrSettings();
  const { ready } = useLibrary();
  const { lang } = useLanguage();
  const { cards } = useCards(ready ? lang : "");
  const { counts } = useReviewCounts(ready ? lang : "", settings.newCardsPerDay);
  const value = useMemo(() => ({ cardCount: cards.length, counts }), [cards.length, counts]);
  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useStudy(): StudyValue {
  const value = useContext(StudyContext);
  if (!value) throw new Error("useStudy outside StudyProvider");
  return value;
}
