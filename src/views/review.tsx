// /review — reviewing the language's flashcards that are due. A card's example opens where it was met (its
// article, or the past transcript at its sentence).

import { ReviewView } from "../components/review-view";
import { useLanguage } from "../shell/language-provider";
import { useLibrary } from "../shell/library-provider";
import { useOpen } from "../shell/open-actions";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import { useStudy } from "../shell/study-provider";

export function ReviewPage() {
  const { c, tokens, settings } = useReadrSettings();
  const { ready } = useLibrary();
  const { lang } = useLanguage();
  const { counts } = useStudy();
  const { openExample } = useOpen();
  useScrollRestore(true);
  if (!ready || !lang) return <div />;
  return <ReviewView key={lang} c={c} tokens={tokens} lang={lang} newPerDay={settings.newCardsPerDay} counts={counts} onOpenSource={openExample} />;
}
