// The right panel: reading settings and the shown article's details, or, beside a live transcript, the
// station's or channel's own settings (its language, Save, Earlier).

import { useTranslation } from "react-i18next";
import type { Channel, Station } from "../../shared/types";
import { languageInfo } from "../../shared/languages";
import type { RadioPanelProps } from "../components/radio-panel";
import { RightPanel } from "../components/right-panel";
import { api } from "../lib/api";
import { useLibrary } from "./library-provider";
import { useOpen } from "./open-actions";
import { useReading } from "./reading-provider";
import { useReadrSettings } from "./settings-provider";

/** A channel in the radio panel's terms (country, website). */
const channelAsStation = (ch: Channel): Station => ({
  id: ch.id, name: ch.name, url: ch.url, homepage: ch.website, favicon: "", country: ch.country, countrycode: ch.country,
  languages: ch.languages, tags: ch.categories, codec: "HLS", bitrate: 0, hls: true,
});

export function SidePanel() {
  const { t } = useTranslation();
  const { settings, update, c } = useReadrSettings();
  const { sites, stations, channels, tryingStation, tryingChannel, saveStation, saveChannel, signedIn } = useLibrary();
  const reading = useReading();
  const open = useOpen();
  const { article, isLive, isTv, isRadio } = reading;

  // The station or channel shown: saved, or being tried from a finder.
  const tried = <T extends { url: string }>(x: T | null) => (x && x.url === article?.url ? x : undefined);
  const savedChannel = isTv ? channels.find((ch) => ch.url === article?.url) : undefined;
  const tvChannel = savedChannel ?? (isTv ? tried(tryingChannel) : undefined);
  const savedStation = isTv ? savedChannel && channelAsStation(savedChannel) : isRadio ? stations.find((st) => st.url === article?.url) : undefined;
  const station = isTv ? tvChannel && channelAsStation(tvChannel) : savedStation ?? (isRadio ? tried(tryingStation) : undefined);
  // Captions trained on a standard variety (Modern Standard Arabic) may be unreliable for a station in dialect;
  // news is in the standard one.
  const info = article ? languageInfo(article.language) : null;
  const captionNote =
    isLive && info && station
      ? info.standardVariety && !station.tags.some((tag) => /news/i.test(tag))
        ? t("app.captionsStandard", { standard: info.standardVariety })
        : info.asrTier === "adaptation"
          ? t("app.captionsUnreliable")
          : null
      : null;

  const openSession = (sessionId: string) => open.openSession(sessionId, { url: article?.url });
  const radio: RadioPanelProps | undefined =
    isLive && article
      ? isTv
        ? { c, article, station, settings, update, saved: Boolean(savedChannel), onSave: () => tvChannel && saveChannel(tvChannel, article.language), onLanguage: (lang) => tvChannel && open.changeChannelLang(tvChannel, lang, Boolean(savedChannel)), translatedCount: reading.translatedCount, captionNote, tv: true, onOpenSession: (s) => openSession(s.id) }
        : { c, article, station, settings, update, saved: Boolean(savedStation), onSave: () => station && saveStation(station, article.language), onLanguage: (lang) => station && open.changeStationLang(station, lang, Boolean(savedStation)), translatedCount: reading.translatedCount, captionNote, onOpenSession: (s) => openSession(s.id) }
      : undefined;

  return (
    <RightPanel
      c={c}
      article={article}
      settings={settings}
      update={update}
      readingProgress={reading.progress}
      sites={sites}
      onLogin={async (siteId) => {
        await api.login(siteId);
        signedIn(); // the sign-in window has closed: what depends on the session is fetched again
      }}
      onViewOriginal={() => article && api.openOriginal(article.url)}
      onToggleFavorite={() => reading.patchArticle({ favorite: !article?.favorite })}
      onToggleArchive={() => reading.patchArticle({ archived: !article?.archived })}
      onDelete={reading.deleteArticle}
      status={reading.sidecar}
      translatedCount={reading.translatedCount}
      onOpenSession={(s) => openSession(s.id)}
      radio={radio}
    />
  );
}
