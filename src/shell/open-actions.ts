// Opening things: a page's address (read into an article or a station), an article once read, a station or
// channel, a past transcript, where a card's example came from, and the way back to what is playing. Each is a
// navigation; only starting a station touches the audio.

import { useMemo } from "react";
import type { CardExample } from "../../shared/cards";
import type { Article, Channel, Station } from "../../shared/types";
import { articleCache } from "../lib/article-cache";
import { startRadio, stopRadio } from "../lib/radio-player";
import { radioStore } from "../lib/radio-session";
import { reopenSelected } from "./open-decision";
import { useLibraryActions } from "./library-provider";
import { usePage, useReadrNavigate, type GoOptions } from "./navigation";
import { useReaderSession } from "./reader-provider";
import { liveKindOf } from "./routes";

export function useOpen() {
  const nav = useReadrNavigate();
  const page = usePage();
  const { load, article: reading } = useReaderSession();
  const { tryStation, saveStation, tryChannel, saveChannel } = useLibraryActions();

  return useMemo(() => {
    const showTranscript = () => {
      const live = radioStore.get().article;
      if (live) nav.toLive(liveKindOf(live), live.id);
    };
    // The article showing, or the station selected: shown as it is, without reading the address again.
    const openUrl = (url: string, o?: GoOptions) => {
      if (page?.page === "article" && articleCache.get(page.articleId)?.url === url) return;
      const live = radioStore.get();
      if (live.article?.url === url && !o?.replace) {
        if (reopenSelected(live) === "restart") {
          const station = live.article;
          stopRadio();
          startRadio(station);
        }
        return showTranscript();
      }
      nav.toOpen(url, o);
    };
    const openSession = (sessionId: string, at: { url?: string | null; sentenceId?: string | null } = {}) =>
      nav.toPast(sessionId, at.sentenceId ?? undefined, at.url ?? undefined);
    return {
      openUrl,
      /** An article that has been read: shown, and read aloud from now on (opening another stops reading). */
      showArticle: (a: Article, o?: GoOptions) => {
        articleCache.remember(a);
        load(a);
        nav.toArticle(a.id, o);
      },
      /** A station or channel: it starts (unless it is the one selected already) and its transcript shows. */
      showLive: (a: Article, o?: GoOptions) => {
        startRadio(a);
        nav.toLive(liveKindOf(a), a.id, o);
      },
      openSession,
      /** From the review screen or the cards list: the transcript it was heard in, else the article. */
      openExample: (e: CardExample) => {
        if (e.liveSessionId) openSession(e.liveSessionId, { url: e.sourceUrl, sentenceId: e.liveSentenceId });
        else if (e.sourceUrl) openUrl(e.sourceUrl);
      },
      playStation: async (st: Station) => {
        await tryStation(st);
        openUrl(st.url);
      },
      playChannel: async (ch: Channel) => {
        await tryChannel(ch);
        openUrl(ch.url);
      },
      /** The radio panel's language: the station is filed under it (or, if only tried, listened to in it this
       * session) and reopened, so its captions restart in that language. */
      changeStationLang: async (st: Station, lang: string, saved: boolean) => {
        await (saved ? saveStation(st, lang) : tryStation({ ...st, languages: [lang] }));
        openUrl(st.url, { replace: true });
      },
      changeChannelLang: async (ch: Channel, lang: string, saved: boolean) => {
        await (saved ? saveChannel(ch, lang) : tryChannel({ ...ch, languages: [lang] }));
        openUrl(ch.url, { replace: true });
      },
      /** Back to the article being read aloud, at the sentence being spoken. Reading carries on. */
      goToReading: () => {
        if (!reading) return;
        nav.toArticle(reading.id, { follow: true });
      },
      /** The selected station's transcript. */
      showTranscript,
    };
  }, [nav, page, load, reading, tryStation, saveStation, tryChannel, saveChannel]);
}
