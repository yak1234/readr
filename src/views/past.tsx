// /past/:sessionId — a past radio or TV transcript, read-only, marked at the sentence a card came from
// (?sentence=), with the way back to the station live and its other sessions.

import { useTranslation } from "react-i18next";
import { Radio as RadioIcon } from "lucide-react";
import type { Article } from "../../shared/types";
import { EarlierToggle, HeaderButton } from "../components/earlier-list";
import { LoadingArticle, Notice } from "../components/notice";
import { ReaderView } from "../components/reader-view";
import { sentenceKeyOf } from "../lib/past-transcript";
import { useRadioState } from "../lib/radio-session";
import { useOpen } from "../shell/open-actions";
import { useReading } from "../shell/reading-provider";
import { useScrollRestore } from "../shell/scroll-memory";
import { useReadrSettings } from "../shell/settings-provider";
import { TranslationNote, useReaderProps } from "./reader-props";

export function PastPage() {
  const { t } = useTranslation();
  const { tokens } = useReadrSettings();
  const { article, status, page } = useReading();
  if (status === "missing") return <Notice tokens={tokens} title={t("app.articleMissing")} />;
  if (!article || page?.page !== "past") return <LoadingArticle tokens={tokens} />;
  return <PastTranscript article={article} sentenceId={page.sentenceId} />;
}

function PastTranscript({ article, sentenceId }: { article: Article; sentenceId: string | undefined }) {
  const { t } = useTranslation();
  const { c } = useReadrSettings();
  const radio = useRadioState();
  const open = useOpen();
  const focus = sentenceId ? sentenceKeyOf(article, sentenceId) : null;
  useScrollRestore(true, (el) => {
    const at = focus ? el.querySelector(`[data-key="${focus}"]`) : null;
    if (at) at.scrollIntoView({ block: "center" });
    else el.scrollTop = 0;
  });

  const url = article.url;
  const backToLive = url ? (
    <HeaderButton c={c} data="back-to-live" onClick={() => (radio.article?.url === url ? open.showTranscript() : open.openUrl(url))}>
      <RadioIcon size={12} strokeWidth={1.8} />
      {t("app.backToLive")}
    </HeaderButton>
  ) : null;
  const earlier = (
    <EarlierToggle c={c} stationIds={[article.past?.stationId ?? "", url].filter(Boolean)} currentSessionId={article.past?.sessionId} onOpen={(s) => open.openSession(s.id, { url })} />
  );
  return (
    <>
      <TranslationNote />
      <ReaderView {...useReaderProps(article)} activeKey={focus} headerActions={<>{backToLive}{earlier}</>} />
    </>
  );
}
