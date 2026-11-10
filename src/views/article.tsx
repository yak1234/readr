// /article/:articleId — an article in the reader. It arrives at its reading progress (or, from the read-aloud
// bar, at the sentence being spoken), returns to where it was left on Back, follows read-aloud, and saves how
// far it has been read.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { ReaderView } from "../components/reader-view";
import { LoadingArticle, Notice } from "../components/notice";
import { api } from "../lib/api";
import { useLibrary } from "../shell/library-provider";
import type { LocationState } from "../shell/navigation";
import { useReader } from "../shell/reader-provider";
import { useReading } from "../shell/reading-provider";
import { useMain, useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import type { Article } from "../../shared/types";
import { TranslationNote, useReaderProps } from "./reader-props";

const at = (main: HTMLElement, key: string) => main.querySelector(`[data-key="${key}"]`);

/** Puts the spoken sentence in view, centred — except the article's first sentence, which leaves the page
 * at its top so the title and standfirst are what the reader sees as reading starts. */
function showSpoken(main: HTMLElement, key: string, behavior: ScrollBehavior): boolean {
  const el = at(main, key);
  if (!el) return false;
  if (main.querySelector("[data-key]") === el) main.scrollTo({ top: 0, behavior });
  else el.scrollIntoView({ block: "center", behavior });
  return true;
}

export function ArticlePage() {
  const { t } = useTranslation();
  const { tokens } = useReadrSettings();
  const { article, status } = useReading();
  if (status === "missing") return <Notice tokens={tokens} title={t("app.articleMissing")} />;
  if (!article) return <LoadingArticle tokens={tokens} />;
  return <ArticleReader key={article.id} article={article} />;
}

function ArticleReader({ article }: { article: Article }) {
  const reader = useReader();
  const { setProgress } = useReading();
  const { refreshLibrary, library } = useLibrary();
  const main = useMain();
  const follow = (useLocation().state as LocationState | null)?.follow;
  const activeKey = reader.article?.id === article.id ? reader.activeKey : null;

  useScrollRestore(true, (el) => {
    if (!(follow && activeKey && showSpoken(el, activeKey, "instant"))) {
      // The library has the latest progress (saved as it is read); a preview or a new article has its own.
      const progress = library.find((a) => a.id === article.id)?.progress ?? article.progress ?? 0;
      el.scrollTop = (progress / 100) * (el.scrollHeight - el.clientHeight);
    }
  });

  // Read-aloud moving on: the sentence being spoken stays in view.
  const followed = useRef(activeKey);
  useEffect(() => {
    if (!activeKey || followed.current === activeKey) return;
    followed.current = activeKey;
    if (main.current) showSpoken(main.current, activeKey, "smooth");
  }, [activeKey, main]);

  // How far it has been read, saved once the scrolling settles.
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    let timer: number | undefined;
    let pending: number | null = null;
    const save = () => {
      window.clearTimeout(timer);
      if (pending === null) return;
      void api.updateArticle(article.id, { progress: pending }).then(refreshLibrary).catch(() => undefined);
      pending = null;
    };
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      pending = max > 0 ? Math.min(100, Math.max(0, Math.round((el.scrollTop / max) * 100))) : 100;
      setProgress(pending);
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 1500);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      save(); // leaving the article: what was read is kept
    };
  }, [article.id, main, setProgress, refreshLibrary]);

  return (
    <>
      <TranslationNote />
      <ReaderView {...useReaderProps(article)} activeKey={activeKey} />
    </>
  );
}
