// What goes with the article the page shows: its translations (fetched as needed, in the target language), the
// word popup and the right-click menu's actions, the reading progress, and the article's own actions
// (favourite, archive, delete). The chrome around the page (title bar, side panel, floating player) reads it too.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import type { Article, SidecarStatus } from "../../shared/types";
import type { ExampleSource } from "../../shared/cards";
import { liveSentenceIdAt } from "../../shared/live-transcript";
import { translationPlan, translationsFor, withoutBlanks } from "../../shared/translation";
import type { WordClick } from "../components/reader-view";
import { api } from "../lib/api";
import { articleCache } from "../lib/article-cache";
import { languageScope } from "../lib/language-scope";
import { useSelectionActions } from "../lib/selection-actions";
import { stationTarget } from "../lib/settings";
import { useLibrary } from "./library-provider";
import { useReadrNavigate } from "./navigation";
import { useReader } from "./reader-provider";
import { useReadrSettings } from "./settings-provider";
import { useShownArticle, type ShownArticle } from "./shown-article";
import { useSidecarStatus } from "./sidecar-status";

export interface ReadingValue extends ShownArticle {
  /** A station or channel (live or past), live now, a past transcript, a live TV channel. */
  isRadio: boolean;
  isLive: boolean;
  isPast: boolean;
  isTv: boolean;
  /** The language it is translated into, and what has been translated. */
  tgt: string;
  translations: Record<string, string>;
  translatedCount: number;
  translateError: string | null;
  /** Same language, or one the translator can't do: no calls, and this note instead. */
  noTranslation: boolean;
  planNote: string;
  sidecar: SidecarStatus | null;
  /** Where a card made from what is shown says its sentence came from. */
  exampleSource: ExampleSource | null;
  /** The word popup over the article shown. */
  popup: WordClick | null;
  /** Opens (or closes) the popup; over another article (`articleId`) it waits until that one shows. */
  setPopup: (p: WordClick | null, articleId?: string) => void;
  selection: ReturnType<typeof useSelectionActions>;
  progress: number;
  setProgress: (pct: number) => void;
  patchArticle: (patch: Partial<Article>) => void;
  deleteArticle: () => void;
}

const ReadingContext = createContext<ReadingValue | null>(null);

export function ReadingProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { settings, tokens } = useReadrSettings();
  const { refreshLibrary } = useLibrary();
  const nav = useReadrNavigate();
  const { unload } = useReader();
  const { key: locationKey } = useLocation();
  const shown = useShownArticle();
  const article = shown.article;
  const sidecar = useSidecarStatus();
  // A popup belongs to the article and the history entry it was opened on (so Back never brings an old one
  // back). One opened for an article about to show (the floating player's "more") waits for the next entry.
  const [popupAt, setPopupAt] = useState<{ articleId: string | undefined; click: WordClick; key?: string; after?: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [fetched, setFetched] = useState<{ key: string; map: Record<string, string> }>({ key: "", map: {} });
  const [translateError, setTranslateError] = useState<string | null>(null);

  // Another article: no error carried over, its own progress.
  const articleId = article?.id;
  const popup = popupAt && popupAt.articleId === articleId && popupAt.key === locationKey ? popupAt.click : null;
  useEffect(() => {
    if (popupAt?.after !== undefined && popupAt.after !== locationKey) setPopupAt({ ...popupAt, key: locationKey, after: undefined });
  }, [popupAt, locationKey]);
  const setPopup = useCallback(
    (click: WordClick | null, at?: string) =>
      setPopupAt(click && (at === undefined ? { articleId, click, key: locationKey } : { articleId: at, click, after: locationKey })),
    [articleId, locationKey],
  );
  useEffect(() => {
    setTranslateError(null);
    setProgress(article?.progress ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const isRadio = article?.kind === "radio" || article?.kind === "tv";
  const isPast = Boolean(article?.past);
  const isLive = isRadio && !isPast;
  const isTv = isLive && article?.kind === "tv";
  // Opening an article or station loads its language's word-analysis models, so the first click is fast.
  const articleLang = article?.language;
  useEffect(() => {
    if (articleLang) api.warmAnalysis(articleLang).catch(() => undefined);
  }, [articleLang]);

  const tgt = isRadio && article ? stationTarget(settings, article.url) : settings.targetLang;
  const translationKey = article ? `${article.id}|${tgt}` : "";
  const translations = useMemo(
    () => ({ ...(article ? translationsFor(article, tgt) : {}), ...(fetched.key === translationKey ? fetched.map : {}) }),
    [article, tgt, fetched, translationKey],
  );
  const allSentences = useMemo(() => (article ? [...new Set([article.title, ...article.blocks.flatMap((b) => b.sentences)].filter(Boolean))] : []), [article]);
  const plan = article ? translationPlan(article.language, tgt, languageScope(article.language).translate) : "ok";
  const noTranslation = plan !== "ok";
  const planNote = article ? t(plan === "same" ? "app.noTranslationSame" : "app.noTranslationFor", { language: languageScope(article.language).native }) : "";
  const viewMode = settings.viewMode;

  useEffect(() => {
    if (!article || viewMode === "original" || noTranslation) return;
    const missing = allSentences.filter((s) => !(s in translations));
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      const CHUNK = 32; // small chunks so the first screen fills in quickly
      for (let i = 0; i < missing.length && !cancelled; i += CHUNK) {
        try {
          const out = await api.translate(article.id, missing.slice(i, i + CHUNK), article.language, tgt);
          if (cancelled) return;
          setFetched((f) => ({ key: translationKey, map: { ...(f.key === translationKey ? f.map : {}), ...withoutBlanks(out) } }));
          setTranslateError(null);
        } catch (e) {
          if (!cancelled) {
            const msg = e instanceof Error ? e.message : "";
            setTranslateError(msg.startsWith("No translation for") ? msg : t("app.translatorNotRunning"));
          }
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the engine comes online, too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article, viewMode, allSentences, sidecar?.ok, tgt]);

  const exampleSource = useMemo<ExampleSource | null>(
    () => (article ? { sourceKind: isRadio ? (article.kind as "radio" | "tv") : "article", sourceId: article.past ? article.past.stationId : article.id, sourceTitle: article.title, sourceUrl: article.url || null } : null),
    [article, isRadio],
  );
  // Right-click on selected text: Translate, or Add to flashcards with the sentence as the example.
  const selection = useSelectionActions({
    lang: article?.language ?? "",
    tgt,
    source: exampleSource,
    sentenceTranslation: (s) => translations[s] ?? "",
    liveSentenceId: (key) => (article ? liveSentenceIdAt(article, key) : undefined),
    highlight: tokens.snapHighlight,
  });

  const patchArticle = useCallback(
    (patch: Partial<Article>) => {
      if (!article || isRadio) return;
      articleCache.remember({ ...article, ...patch });
      api.updateArticle(article.id, patch).then(refreshLibrary).catch(() => undefined);
    },
    [article, isRadio, refreshLibrary],
  );
  // Deleted: forgotten here and by read-aloud (which stops); its page has nothing left to show.
  const deleteArticle = useCallback(() => {
    if (!article) return;
    articleCache.forget(article.id);
    unload(article.id);
    api.deleteArticle(article.id).then(refreshLibrary, () => undefined);
    nav.toHome();
  }, [article, unload, refreshLibrary, nav]);
  const { result, close } = selection;
  const translatedCount = useMemo(() => allSentences.filter((s) => translations[s]).length, [allSentences, translations]);
  const { page, status } = shown;

  const value = useMemo<ReadingValue>(
    () => ({
      page, article, status, isRadio, isLive, isPast, isTv, tgt, translations, translatedCount, translateError, noTranslation, planNote, sidecar,
      exampleSource, popup, setPopup, selection: { result, close }, progress, setProgress, patchArticle, deleteArticle,
    }),
    [page, article, status, isRadio, isLive, isPast, isTv, tgt, translations, translatedCount, translateError, noTranslation, planNote, sidecar, exampleSource, popup, setPopup, result, close, progress, patchArticle, deleteArticle],
  );
  return <ReadingContext.Provider value={value}>{children}</ReadingContext.Provider>;
}

export function useReading(): ReadingValue {
  const value = useContext(ReadingContext);
  if (!value) throw new Error("useReading outside ReadingProvider");
  return value;
}
