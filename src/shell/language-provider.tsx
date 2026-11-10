// The language showing: which one, the ones the switch offers, and choosing another. It wraps the pages in that
// language's LanguageScope (direction, fonts, formatters, its own sources).

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { defaultLang, languagesWithContent, orderLangs, sourceNamesFor } from "../../shared/language-switch";
import { LanguageScope } from "../lib/language-scope";
import { useLibrary } from "./library-provider";
import { pageAt, paths } from "./routes";
import { useReadrSettings } from "./settings-provider";

export interface LanguageValue {
  /** The language showing ("" until one is known). */
  lang: string;
  /** The languages the switch offers: those with content, those picked this session, and the one showing. */
  languages: string[];
  changeLang: (lang: string) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { settings, update } = useReadrSettings();
  const { feeds, stations, library, sites, channels, ready } = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  // Languages picked with "+" this session (they may have nothing in them yet).
  const [picked, setPicked] = useState<string[]>([]);
  const available = useMemo(() => languagesWithContent(feeds, stations, library, sites, channels), [feeds, stations, library, sites, channels]);
  const known = useMemo(() => orderLangs([...available, ...picked]), [available, picked]);
  // Until everything has loaded the saved language stands (or none): no guessing, no wrong-language fetches.
  const lang = ready ? defaultLang(settings, known) : settings.currentLang;
  const languages = useMemo(() => (!lang || known.includes(lang) ? known : orderLangs([...known, lang])), [known, lang]);
  const sourceNames = useMemo(() => sourceNamesFor(lang, sites, feeds), [lang, sites, feeds]);

  // Choosing a language shows it everywhere: a finder starts over in it, and a section from the old language has
  // nothing to show here.
  const hereRef = useRef(pageAt(location.pathname + location.search));
  hereRef.current = pageAt(location.pathname + location.search);
  const changeLang = useCallback(
    (l: string) => {
      update("currentLang", l);
      setPicked((p) => (p.includes(l) ? p : [...p, l]));
      const here = hereRef.current;
      if (here?.page === "find") navigate(paths.find(here.kind, l), { replace: true });
      else if (here?.page === "source" && feeds.find((f) => f.id === here.section)?.lang !== l) navigate(paths.home());
    },
    [update, feeds, navigate],
  );

  const value = useMemo(() => ({ lang, languages, changeLang }), [lang, languages, changeLang]);
  return (
    <LanguageContext.Provider value={value}>
      <LanguageScope lang={lang} sourceNames={sourceNames}>
        {children}
      </LanguageScope>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage outside LanguageProvider");
  return value;
}
