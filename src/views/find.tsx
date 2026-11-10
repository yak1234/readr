// /find/:kind?lang= — finding radio stations or TV channels, starting on a language. Playing one opens it;
// Save files it under a language.

import { RadioFinder } from "../components/radio-finder";
import { TvFinder } from "../components/tv-finder";
import { useLanguage } from "../shell/language-provider";
import { useLibrary } from "../shell/library-provider";
import { usePage } from "../shell/navigation";
import { useOpen } from "../shell/open-actions";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";

export function FindPage() {
  const { tokens } = useReadrSettings();
  const { stations, channels, saveStation, saveChannel } = useLibrary();
  const { lang } = useLanguage();
  const { playStation, playChannel } = useOpen();
  const page = usePage();
  useScrollRestore(true);
  if (page?.page !== "find") return null;
  const start = page.lang || lang;
  return page.kind === "tv" ? (
    <TvFinder key={start} tokens={tokens} initialLang={start} saved={channels} onPlay={playChannel} onSave={saveChannel} />
  ) : (
    <RadioFinder key={start} tokens={tokens} initialLang={start} saved={stations} onPlay={playStation} onSave={saveStation} />
  );
}
