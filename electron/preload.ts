import { contextBridge, ipcRenderer } from "electron";
import type { FloatingCommand, FloatingState, LiveEvent, MenuAction, ReadrApi } from "../shared/types";

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const fire = (channel: string) => (...args: unknown[]) => ipcRenderer.send(channel, ...args);

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: unknown, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: ReadrApi = {
  sites: call("sites"),
  login: call("login"),
  openOriginal: call("openOriginal"),
  passBrowserCheck: call("passBrowserCheck"),
  feeds: call("feeds"),
  sourceSections: call("sourceSections"),
  followSections: call("followSections"),
  fetchFeed: call("fetchFeed"),
  extract: call("extract"),
  libraryState: call("library:state"),
  retryUpgrade: call("library:retryUpgrade"),
  showLibraryFolder: call("library:showFolder"),
  library: call("library"),
  getArticle: call("getArticle"),
  updateArticle: call("updateArticle"),
  deleteArticle: call("deleteArticle"),
  translate: call("translate"),
  lookup: call("lookup"),
  warmAnalysis: call("warmAnalysis"),
  sidecarStatus: call("sidecarStatus"),
  ttsStatus: call("ttsStatus"),
  speak: call("speak"),
  phrase: call("phrase"),
  translateSelection: call("translateSelection"),
  selectionState: fire("selection:state"),
  onMenu: (cb) => {
    const offs = (["translate", "add-card"] as const).map((a: MenuAction) => listen<void>(`menu:${a}`, () => cb(a)));
    return () => offs.forEach((off) => off());
  },
  cardsAdd: call("cards:add"),
  cardsFillTranslation: call("cards:fillTranslation"),
  cardsDue: call("cards:due"),
  cardsReview: call("cards:review"),
  cardsCounts: call("cards:counts"),
  cardsList: call("cards:list"),
  cardsSuspend: call("cards:suspend"),
  cardsDelete: call("cards:delete"),
  cardsEdit: call("cards:edit"),
  cardsExamples: call("cards:examples"),
  cardsPreviewIntervals: call("cards:previewIntervals"),
  cardsLiveSentences: call("cards:liveSentences"),
  cardsSavedSurfaces: call("cards:savedSurfaces"),
  cardsExport: call("cards:export"),
  liveSessions: call("history:sessions"),
  liveTranscript: call("history:transcript"),
  activityToday: call("activity:today"),
  importDialogOpen: call("importDialogOpen"),
  importDialogClose: call("importDialogClose"),
  modelState: call("modelState"),
  browserSites: call("browserSites"),
  classifySites: call("classifySites"),
  importLogins: call("importLogins"),
  discoverSource: call("discoverSource"),
  addSource: call("addSource"),
  removeSource: call("removeSource"),
  catalog: call("catalog"),
  addCatalogSource: call("addCatalogSource"),
  stations: call("stations"),
  saveStation: call("saveStation"),
  removeStation: call("removeStation"),
  previewStation: call("previewStation"),
  radioSearch: call("radioSearch"),
  radioCountries: call("radioCountries"),
  radioLanguages: call("radioLanguages"),
  channels: call("channels"),
  saveChannel: call("saveChannel"),
  removeChannel: call("removeChannel"),
  previewChannel: call("previewChannel"),
  tvSearch: call("tvSearch"),
  tvAudioOnly: call("tvAudioOnly"),
  onWindowVisible: (cb) => listen<boolean>("window:visible", cb),

  liveStart: call("liveStart"),
  liveStop: call("liveStop"),
  livePcm: fire("live:pcm"),
  onLiveEvent: (cb) => listen<LiveEvent>("live:event", cb),

  floatingOpen: call("floatingOpen"),
  floatingClose: call("floatingClose"),
  floatingPush: fire("floating:push"),
  floatingReady: call("floatingReady"),
  onFloatingState: (cb) => listen<FloatingState>("floating:state", cb),
  floatingCommand: fire("floating:command"),
  onFloatingCommand: (cb) => listen<FloatingCommand>("floating:command", cb),
  onCardsChanged: (cb) => listen<void>("cards:changed", () => cb()),
  onHistoryChanged: (cb) => listen<void>("history:changed", () => cb()),
  onActivityChanged: (cb) => listen<void>("activity:changed", () => cb()),
} as ReadrApi;

contextBridge.exposeInMainWorld("readr", api);
