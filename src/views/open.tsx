// /open?url= — a page's address being read in the user's session. It gives way to the article (or the
// station) once read, in its place in history; a page that can't be read, or only as a preview behind a
// subscription, or whose site wants its browser check passed first, says so here with what can be done. Coming Back or Forward onto an address that never finished
// opening shows what it is without starting it (afterOpen).

import { useEffect, useRef, useState } from "react";
import { useNavigationType } from "react-router";
import { useTranslation } from "react-i18next";
import type { Article, Site } from "../../shared/types";
import { cleanIpcError } from "../../shared/errors";
import { LoadingArticle, Notice, NoticeButton } from "../components/notice";
import { api } from "../lib/api";
import { articleCache } from "../lib/article-cache";
import { radioStore } from "../lib/radio-session";
import { useLibrary } from "../shell/library-provider";
import { usePage, useReadrNavigate } from "../shell/navigation";
import { afterOpen } from "../shell/open-decision";
import { useOpen } from "../shell/open-actions";
import { liveKindOf } from "../shell/routes";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";

type Outcome = { kind: "loading" } | { kind: "error"; message: string } | { kind: "browser-check"; host: string } | { kind: "paywall"; preview: Article; site: Site | undefined } | { kind: "not-playing"; live: Article };

export function OpenPage() {
  const { t } = useTranslation();
  const { tokens } = useReadrSettings();
  const { sites, signIns, signedIn, refreshLibrary } = useLibrary();
  const page = usePage();
  const url = page?.page === "open" ? page.url : "";
  const open = useOpen();
  const nav = useReadrNavigate();
  const returning = useNavigationType() === "POP";
  const act = useRef({ open, nav, returning });
  act.current = { open, nav, returning };
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });
  const retry = () => setAttempt((n) => n + 1);
  useScrollRestore(true);

  // Read again after a sign-in too (here or from the side panel).
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setOutcome({ kind: "loading" });
    api.extract(url).then(
      (r) => {
        if (cancelled) return;
        if (r.browserCheck) return setOutcome({ kind: "browser-check", host: new URL(url).hostname.replace(/^www\./, "") });
        if (!r.ok || !r.article) return setOutcome({ kind: "error", message: cleanIpcError(r.error || t("app.couldNotRead")) });
        if (r.paywalled) {
          const host = new URL(url).hostname;
          return setOutcome({ kind: "paywall", preview: r.article, site: sitesRef.current.find((s) => s.hosts.some((h) => host.endsWith(h))) });
        }
        const a = r.article;
        const live = a.kind === "radio" || a.kind === "tv";
        const { open, nav, returning } = act.current;
        // A retry is the user's own: only the first reading of an address come back to is quiet.
        const next = afterOpen({ live, returning: returning && attempt === 0, selected: radioStore.get().article?.url === a.url });
        if (next === "play") open.showLive(a, { replace: true });
        else if (next === "show-live") nav.toLive(liveKindOf(a), a.id, { replace: true });
        else if (next === "not-playing") setOutcome({ kind: "not-playing", live: a });
        else if (next === "read") open.showArticle(a, { replace: true });
        else {
          articleCache.remember(a);
          nav.toArticle(a.id, { replace: true });
        }
        if (!live) void refreshLibrary();
      },
      (e) => !cancelled && setOutcome({ kind: "error", message: cleanIpcError(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [url, attempt, signIns, refreshLibrary, t]);

  if (outcome.kind === "loading") return <LoadingArticle tokens={tokens} />;
  if (outcome.kind === "error")
    return (
      <Notice tokens={tokens} title={t("app.openFailed")} body={outcome.message}>
        <NoticeButton tokens={tokens} onClick={retry}>{t("app.tryAgain")}</NoticeButton>
        <NoticeButton tokens={tokens} onClick={() => api.openOriginal(url).then(retry)}>{t("app.openPage")}</NoticeButton>
      </Notice>
    );
  if (outcome.kind === "browser-check")
    return (
      <Notice tokens={tokens} title={t("app.browserCheck", { site: outcome.host })} body={t("app.browserCheckBody")}>
        <NoticeButton tokens={tokens} primary onClick={() => api.passBrowserCheck(url).then(retry)}>{t("app.showCheck")}</NoticeButton>
        <NoticeButton tokens={tokens} onClick={retry}>{t("app.tryAgain")}</NoticeButton>
      </Notice>
    );
  if (outcome.kind === "not-playing")
    return (
      <Notice tokens={tokens} title={t("app.notPlaying")} body={t("app.notPlayingBody")}>
        <NoticeButton tokens={tokens} primary onClick={() => open.showLive(outcome.live, { replace: true })}>{t("app.playAgain")}</NoticeButton>
      </Notice>
    );
  const { site, preview } = outcome;
  return (
    <Notice tokens={tokens} title={site ? t("app.notSignedInTo", { site: site.name }) : t("app.notSignedIn")} body={t("app.previewOnly")}>
      {site && (
        <NoticeButton tokens={tokens} primary onClick={() => api.login(site.id).then(signedIn)}>
          {t("app.signInTo", { site: site.name })}
        </NoticeButton>
      )}
      <NoticeButton tokens={tokens} onClick={retry}>{t("app.tryAgain")}</NoticeButton>
      <NoticeButton tokens={tokens} onClick={() => open.showArticle(preview, { replace: true })}>{t("app.readPreview")}</NoticeButton>
    </Notice>
  );
}
