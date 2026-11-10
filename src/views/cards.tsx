// /cards — the language's flashcards, searchable and editable. A card's example opens where it was met (its
// article, or the past transcript at its sentence).

import { CardsView } from "../components/cards-view";
import { useLanguage } from "../shell/language-provider";
import { useLibrary } from "../shell/library-provider";
import { useOpen } from "../shell/open-actions";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import { useStudy } from "../shell/study-provider";

export function CardsPage() {
  const { c, tokens } = useReadrSettings();
  const { ready } = useLibrary();
  const { lang } = useLanguage();
  const { cardCount } = useStudy();
  const { openExample } = useOpen();
  useScrollRestore(ready && Boolean(lang));
  if (!ready || !lang) return <div />;
  return <CardsView key={lang} c={c} tokens={tokens} lang={lang} total={cardCount} onOpenSource={openExample} />;
}
