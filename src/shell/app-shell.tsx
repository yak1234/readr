// The window around the pages: title bar, left panel, the page (the router's outlet) in the scrolling main
// column, the right panel, and what stays put across pages (the radio bar, the read-aloud bar, the word popup,
// the floating player's link). It also holds the reading shortcuts.

import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router";
import { findSpan, newCardFrom } from "../../shared/cards";
import { liveSentenceIdAt } from "../../shared/live-transcript";
import { DictionaryPopup } from "../components/dictionary-popup";
import { LEFT_W, LeftSidebar } from "../components/left-sidebar";
import { RadioBar } from "../components/radio-bar";
import { SelectionPopup } from "../components/selection-popup";
import { UpgradeFailed } from "../components/upgrade-failed";
import { api } from "../lib/api";
import { radioStore } from "../lib/radio-session";
import { countRender } from "../lib/store";
import { UI_FONT } from "../lib/theme";
import { FloatingBridge } from "./floating-bridge";
import { useLibraryStartup } from "./library-provider";
import { useLiveWindow } from "./live-window";
import { isTypingTarget } from "./keys";
import { usePage } from "./navigation";
import { useOpen } from "./open-actions";
import { ReaderBar } from "./reader-bar";
import { useReaderSession } from "./reader-provider";
import { useReading } from "./reading-provider";
import { ScrollMemory } from "./scroll-memory";
import { useReadrSettings } from "./settings-provider";
import { SidePanel } from "./side-panel";
import { TitleBar, VIEW_MODES } from "./title-bar";

const RADIO_BAR_H = 53;
const RIGHT_W = 210;
/** The title bar's left end with the panel hidden: the window's buttons, the panel icon, Back and Forward. */
const LEFT_COLLAPSED_W = 170;

// The sidebar redraws for its own data and the page, not for every change of what is read or heard.
const Sidebar = memo(LeftSidebar);

export function AppShell() {
  countRender("AppShell");
  const { t } = useTranslation();
  const { settings, update, c, tokens } = useReadrSettings();
  const { libraryState, retryUpgrade, loadFailed } = useLibraryStartup();
  // The shell follows which article is read aloud and which station is selected, not the sentence being read
  // nor the station's transcript, so it doesn't redraw for every sentence or caption. (The title bar, the side
  // panel and the floating player's link show those, and redraw for them themselves.)
  const reader = useReaderSession();
  const liveId = useSyncExternalStore(radioStore.subscribe, () => radioStore.get().article?.id ?? null);
  const { showTranscript } = useOpen();
  const page = usePage();
  const mainRef = useRef<HTMLElement>(null);
  useLiveWindow();

  // 1–4 pick the view mode and f the focus mode, except while typing or reviewing (there 1–4 rate the card).
  const reviewing = page?.page === "review";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || reviewing) return;
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) update("viewMode", VIEW_MODES[idx].id);
      if (e.key === "f") update("focusMode", settings.focusMode === "article" ? "off" : "article");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update, settings.focusMode, reviewing]);

  if (libraryState?.library === "upgrade-failed")
    return <UpgradeFailed c={c} tokens={tokens} message={libraryState.message} onRetry={retryUpgrade} onShowFolder={() => void api.showLibraryFolder().catch(() => undefined)} />;

  const distractionFree = settings.focusMode === "article";
  const showLeft = !distractionFree && !settings.sidebarHidden;
  const showRight = !distractionFree && settings.showRightPanel && !reviewing; // reviewing is the whole page
  const transcriptOpen = page?.page === "live" && liveId === page.id;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", fontFamily: UI_FONT, background: tokens.bg, color: tokens.text, transition: "background 0.3s ease" }}>
      <TitleBar leftWidth={showLeft ? LEFT_W : LEFT_COLLAPSED_W} />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {showLeft && <Sidebar />}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          {loadFailed && <div data-load-failed style={{ padding: "6px 16px", fontSize: 11, color: c.muted, background: c.panel, borderBottom: `1px solid ${c.border}` }}>{t("app.loadFailed")}</div>}
          <main ref={mainRef} style={{ flex: 1, overflowY: "auto", background: tokens.bg, paddingBottom: reader.listening ? 70 : 0, transition: "background 0.3s ease" }}>
            <ScrollMemory main={mainRef}>
              <Outlet />
            </ScrollMemory>
          </main>
        </div>
        {showRight && <SidePanel />}
      </div>

      <RadioBar c={c} transcriptOpen={transcriptOpen} onOpenTranscript={showTranscript} />
      <ReaderBar left={showLeft ? LEFT_W : 0} right={showRight ? RIGHT_W : 0} bottom={liveId ? RADIO_BAR_H : 0} />
      <FloatingBridge />
      <ReadingPopups />
    </div>
  );
}

/** The word popup and the selection's, over what is shown: they follow the page's article and its translations. */
function ReadingPopups() {
  const { c, settings } = useReadrSettings();
  const reading = useReading();
  const { popup, article, exampleSource, translations, tgt, selection } = reading;
  return (
    <>
      {popup && article && exampleSource && (
        <DictionaryPopup
          c={c}
          word={popup.word}
          sentence={popup.sentence}
          sentenceTranslation={translations[popup.sentence] ?? ""}
          rect={popup.rect}
          lang={article.language}
          tgt={tgt}
          voiceURI={settings.voiceURI}
          onClose={() => reading.setPopup(null)}
          onSave={async ({ word, lemma, gloss }) => {
            const liveSentenceId = popup.sentenceKey ? liveSentenceIdAt(article, popup.sentenceKey) : undefined;
            return api.cardsAdd(
              newCardFrom({ lang: article.language, form: lemma, translation: gloss, sentence: popup.sentence, sentenceTranslation: translations[popup.sentence], source: exampleSource, span: popup.span ?? findSpan(popup.sentence, word), liveSentenceId }),
            );
          }}
        />
      )}
      {selection.result && <SelectionPopup c={c} lang={article?.language ?? ""} result={selection.result} onClose={selection.close} />}
    </>
  );
}
