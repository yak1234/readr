import "./user-data"; // first: it may move the data folder
import { app, BrowserWindow, dialog, ipcMain, session as electronSession, shell, Session } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Article, SelectionTranslation } from "../shared/types";
import { extractArticle } from "./extract";
import { FEED_TIMEOUT_MS, fetchFeed } from "./feeds";
import { FEEDS, SITES } from "./sites";
import { CATALOG } from "./catalog";
import { hostsForHomepage } from "./cookie-policy";
import { activeFeeds, discoverFromSite, sectionsFor } from "./sections";
import { discoverSource, loadPageHtml, mergeSources, sourceIdFor } from "./sources";
import { waitPastCheck } from "./browser-check";
import { createPoliteness } from "./polite";
import type { Lang, UserSource } from "../shared/types";
import * as store from "./store";
import { openDb } from "./db";
import { importJsonLibrary } from "./db/migrate-json";
import { LibraryStartup } from "./library-startup";
import * as sidecar from "./sidecar";
import { isValidStation, mergeBuiltins, removeStation, saveStation } from "./stations";

import type { Channel, SavedChannel, SavedStation, Station, TvQuery } from "../shared/types";
import { cleanChannel, isValidChannel, mergeBuiltinChannels, removeChannel, saveChannel } from "./channels";
import { createTvIndex, isPublicStreamUrl, searchChannels } from "./tv";
import { audioOnlyVariant } from "../shared/hls";
import { appendHistory, contextFor, translationPlan, translationsFor, usableTranslations } from "../shared/translation";
import { languageInfo } from "../shared/languages";
import { BROWSERS, importBrowserLogins, listBrowserSites, type Browser } from "./browser-login";
import { getDomain } from "tldts";
import { isBlockedHost } from "./cookie-policy";
import { classifyState, fetchSiteInfo, modelAvailable, modelState, startModel, stopModel } from "./decision-model";
import { allowedSites } from "./import-guard";
import { classifyNew } from "../shared/site-kinds";
import { LATEST_FEED_NAME } from "../shared/section-choice";
import { isHttpUrl, radioArticle, tvArticle } from "../shared/live";
import { liveClips, liveTranslated, registerLiveIpc, stopLive, type LiveStation } from "./live";
import { closeDangling, prune as pruneLiveHistory, saveTranslations as keepPastTranslations } from "./live-history";
import * as activity from "./activity";
import { closeFloating, isFloatingSender, registerFloatingIpc } from "./floating";
import { registerCardsIpc } from "./cards-ipc";
import { registerLiveHistoryIpc } from "./live-history-ipc";
import { attachSelectionMenu, registerSelectionState } from "./selection-menu";

const savedStations = () => {
  const offered = store.loadOfferedBuiltins();
  const merged = mergeBuiltins(store.loadStations(), offered);
  if (merged.offered.length !== offered.length) {
    store.saveStations(merged.stations);
    store.saveOfferedBuiltins(merged.offered);
  }
  return merged.stations;
};
// Stations being tried from the finder: playable this session, not in the user's list.
const previewStations = new Map<string, SavedStation>();
const knownStation = (url: string) => savedStations().find((st) => st.url === url) ?? previewStations.get(url);

const savedChannels = () => {
  const offered = store.loadOfferedChannels();
  const merged = mergeBuiltinChannels(store.loadChannels(), offered);
  if (merged.offered.length !== offered.length) {
    store.saveChannels(merged.channels);
    store.saveOfferedChannels(merged.offered);
  }
  return merged.channels;
};
// Channels being tried from Find channels: playable this session, not in the user's list.
const previewChannels = new Map<string, SavedChannel>();
/** A saved or previewed channel, only ever on a public host (never this machine or the LAN). */
const knownChannel = (url: string) => (isPublicStreamUrl(url) ? savedChannels().find((c) => c.url === url) ?? previewChannels.get(url) : undefined);
/** A station or channel live captions may open (ffmpeg only ever opens these). */
const knownLive = (url: string): LiveStation | undefined => {
  const station = knownStation(url);
  if (station) return { url: station.url, lang: station.lang, id: station.id, name: station.name, kind: "radio" };
  const channel = knownChannel(url);
  return channel && { url: channel.url, lang: channel.lang, id: channel.id, name: channel.name, kind: "tv" };
};
/** Find channels' index, cached in userData. */
let tvIndex: (() => Promise<Channel[]>) | null = null;

const PARTITION = "persist:readr"; // cookies/logins survive restarts
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
/** Whether an IPC call comes from the main window (writes and anything that fetches for the user need it). */
const fromMain = (e: { sender: Electron.WebContents }) => Boolean(mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents);

// The library (articles, translations, saved words) is in the database. At start the database
// opens, the one-time JSON upgrade runs, and only then is library IPC served; while the upgrade
// has failed, reads come back empty and writes are refused.
const libraryStartup = new LibraryStartup({
  dbFile: path.join(app.getPath("userData"), "readr.db"),
  libraryDir: store.libraryDir(),
  open: openDb,
  importLibrary: importJsonLibrary,
  attach: store.attachLibrary,
  // Sessions a crash left open are ended before any new one can start.
  prepare: async (db) => {
    const closed = await closeDangling(db);
    if (closed) console.log(`Live history: ended ${closed} session(s) left open.`);
  },
});
/** True once the library is usable; waits for the upgrade the renderer asks for at start. */
const libraryReady = () => libraryStartup.ready();

/** Live transcripts are kept 30 days: pruned once the library is ready, then every day. */
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
async function pruneLive() {
  const db = await libraryStartup.database();
  if (!db) return;
  const removed = await pruneLiveHistory(db, new Date()).catch((e) => console.error("Pruning the live history failed:", e));
  if (removed && (removed.sessions || removed.sentences)) console.log("Live history pruned:", removed);
}

/** Translations shown for a live transcript, kept in the live history: a past one's (its id is
 * "past:<session id>") or the session being recorded for that station. Never waits on the library. */
async function keepLiveTranslations(articleId: string, tgt: string, map: Record<string, string>) {
  const db = libraryStartup.current();
  if (!db) return;
  const past = /^past:(.+)$/.exec(articleId);
  if (past) await keepPastTranslations(db, past[1], tgt, map).catch((e) => console.error("Keeping translations failed:", e));
  else await liveTranslated(articleId, tgt, map);
}

/** Logs an article opened as today's activity (reviews and listening are logged where they are written). Never waits. */
function articleOpened(articleId: string) {
  const db = libraryStartup.current();
  if (db) void activity.record(db, "article", articleId, 1, new Date()).catch((e) => console.error("Logging activity failed:", e));
}

function newsSession(): Session {
  return electronSession.fromPartition(PARTITION);
}

function configureSession(s: Session) {
  // Present as plain Chrome: some sites treat the Electron UA differently.
  const ua = s.getUserAgent().replace(/\s(Electron|readr)\/\S+/gi, "");
  s.setUserAgent(ua);
  app.userAgentFallback = ua;
  // Never let pages ask for camera/mic/notifications/etc.
  s.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: "#FAFAF7",
    title: "Readr",
    show: !process.env.READR_HIDDEN, // automated tests run without a visible window
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Radio keeps playing and being transcribed while this window is minimised or hidden.
      backgroundThrottling: false,
    },
  });

  // TV saves data while nobody can see the window (minimised or hidden): the renderer switches to audio only.
  // Each event says which way it went: while "hide" runs, isVisible() is still true.
  const visibility = (visible: boolean) => () => {
    const w = mainWindow;
    if (w && !w.isDestroyed()) w.webContents.send("window:visible", visible && !w.isMinimized());
  };
  mainWindow.on("hide", visibility(false));
  mainWindow.on("minimize", visibility(false));
  mainWindow.on("show", visibility(true));
  mainWindow.on("restore", visibility(true));
  mainWindow.on("focus", visibility(true));
  mainWindow.on("closed", () => {
    stopModel(); // the import dialog's model never outlives the window
    closeFloating();
    void stopLive(); // on macOS the app outlives its window: don't leave ffmpeg and the recogniser running
    mainWindow = null;
  });
  // A reload or a crashed renderer loses the page that owns the live session.
  mainWindow.webContents.on("did-start-navigation", (e) => {
    if (e.isMainFrame && !e.isSameDocument) void stopLive();
  });
  mainWindow.webContents.on("render-process-gone", () => void stopLive());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
  });

  // The page asks for the library at start; if it never does, the upgrade runs anyway.
  mainWindow.webContents.once("did-finish-load", () => libraryStartup.startAfter(5000));
  attachSelectionMenu(mainWindow).catch((err) => console.error("The right-click menu couldn't load:", err));

  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
}

/** One queue per site for everything Readr loads from it (feeds, pages, articles). */
const polite = createPoliteness();

/** How long the reader has to pass a browser check in its window before the window stops watching for it. */
const CHECK_WINDOW_MS = 5 * 60_000;

/** A visible browser window in the shared news session. Resolves when closed. `closeOncePastCheck`: it shows a
 * site's browser check for the reader to pass, and closes by itself once the real page is there. */
function openSiteWindow(url: string, title: string, { closeOncePastCheck = false } = {}): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      parent: mainWindow ?? undefined,
      title,
      show: !process.env.READR_HIDDEN, // automated tests run without a visible window
      autoHideMenuBar: true,
      webPreferences: { session: newsSession(), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    // Sign-in flows sometimes open popups (e.g. SSO); keep them in the same session.
    win.webContents.setWindowOpenHandler(() => ({
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: win,
        autoHideMenuBar: true,
        webPreferences: { session: newsSession(), sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    }));
    win.on("closed", () => resolve());
    win.loadURL(url);
    if (closeOncePastCheck) {
      win.webContents.once("did-finish-load", () => {
        void waitPastCheck(win.webContents, CHECK_WINDOW_MS).then((passed) => passed && !win.isDestroyed() && win.close());
      });
    }
  });
}

/** Built-in plus user-added sources. */
const allSources = () => mergeSources(SITES, FEEDS, store.listUserSources());
/** The feeds the reader follows (a source's defaults until sections are picked). */
/** Discovered sections plus the followed ones saved with the choice (these survive a lost cache). */
const cacheWithFollowed = () => {
  const cache = store.getSectionsCache();
  const saved = store.getFollowedSections();
  return Object.fromEntries([...new Set([...Object.keys(cache), ...Object.keys(saved)])].map((k) => [k, [...(saved[k] ?? []), ...(cache[k] ?? [])]]));
};
const sectionDeps = () => ({
  user: store.listUserSources(),
  cache: store.getSectionsCache(),
  saveCache: store.setSectionsCache,
  discover: (homepage: string) => discoverFromSite(homepage, (url) => polite.visit(url, () => loadPageHtml(url, newsSession()))),
});
const followedFeeds = () => activeFeeds(SITES, FEEDS, store.listUserSources(), store.getFollowed, cacheWithFollowed());
const allHosts = () => allSources().sites.flatMap((s) => s.hosts);
/** Hosts whose logins are refreshed automatically: the sources plus the sites chosen for import. */
const reimportHosts = () => [...new Set([...allHosts(), ...store.getImportSites()])].filter((h) => !isBlockedHost(h));
const registrable = (hosts: string[]) => hosts.map((h) => getDomain(h)).filter((d): d is string => Boolean(d));
/** Sites always ticked in the import dialog: sources, saved stations' homepages and catalogue sites. */
const alwaysSites = () => {
  const stationHosts = savedStations().flatMap((s) => { try { return s.homepage ? [new URL(s.homepage).hostname] : []; } catch { return []; } });
  return [...new Set(registrable([...allHosts(), ...stationHosts, ...CATALOG.flatMap((c) => c.hosts)]))].filter((d) => !isBlockedHost(d));
};

/** The sites the last browserSites call returned: the only ones the dialog may classify or import. */
let listedSites = new Set<string>();

function registerIpc() {
  ipcMain.handle("sites", () => allSources().sites);

  ipcMain.handle("login", async (_e, siteId: string) => {
    const site = allSources().sites.find((s) => s.id === siteId);
    if (!site) return;
    await openSiteWindow(site.loginUrl, `Sign in — ${site.name}`);
  });

  // Import logins from a browser: the user picks the sites; the model only suggests.
  ipcMain.handle("importDialogOpen", () => {
    startModel();
    return { browser: store.getLoginBrowser(), chosen: store.getImportSites() };
  });
  ipcMain.handle("importDialogClose", () => {
    stopModel();
    listedSites = new Set();
  });
  ipcMain.handle("modelState", () => modelState());

  ipcMain.handle("browserSites", async (_e, browser: Browser) => {
    const none = { sites: [], always: [], chosen: [], classes: {} };
    if (!BROWSERS.includes(browser)) return { ok: false, error: "Unknown browser.", ...none };
    try {
      const sites = await listBrowserSites(browser);
      listedSites = new Set(sites.map((s) => s.site));
      const classes = store.getSiteKinds();
      return { ok: true, sites, always: alwaysSites(), chosen: store.getImportSites(), classes: Object.fromEntries(sites.flatMap((s) => (classes[s.site] ? [[s.site, classes[s.site]]] : []))) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), ...none };
    }
  });

  ipcMain.handle("classifySites", async (_e, sites: string[]) => {
    const wanted = allowedSites(sites, listedSites).slice(0, 100);
    const found = await classifyNew(wanted, store.getSiteKinds(), { available: modelAvailable, fetchInfo: fetchSiteInfo, classify: classifyState });
    if (Object.keys(found).length > 0) store.addSiteKinds(found);
    return found;
  });

  ipcMain.handle("importLogins", async (_e, browser: Browser, sites: string[]) => {
    if (!BROWSERS.includes(browser)) return { ok: false, imported: 0, domains: [], error: "Unknown browser." };
    // Never trust the UI: only registrable domains from this dialog's listing; blocked hosts are
    // dropped again before each cookie is written.
    const chosen = allowedSites(sites, listedSites);
    if (chosen.length === 0) return { ok: true, imported: 0, domains: [] };
    try {
      const r = await importBrowserLogins(browser, newsSession(), chosen);
      store.setImportSites(chosen);
      if (r.imported > 0) store.setLoginBrowser(browser);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, imported: 0, domains: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // A browser check that didn't pass by itself: shown to the reader, in the session articles are read in, so
  // passing it there is what the next read needs. Resolves when the window closes (by itself, once passed).
  ipcMain.handle("passBrowserCheck", async (_e, url: string) => {
    if (!/^https?:/.test(url)) return;
    await openSiteWindow(url, "Browser check", { closeOncePastCheck: true });
  });

  ipcMain.handle("openOriginal", async (_e, url: string) => {
    if (!/^https?:/.test(url)) return;
    await openSiteWindow(url, "Original article");
  });

  ipcMain.handle("feeds", () => followedFeeds());

  ipcMain.handle("sourceSections", async (_e, sourceId: string) => {
    const sections = await sectionsFor(sourceId, sectionDeps());
    // Never chosen: the ticked ones are the feeds shown today.
    const { sites, feeds } = allSources();
    const name = sites.find((s) => s.id === sourceId)?.name;
    const followed = store.getFollowed(sourceId) ?? feeds.filter((f) => f.source === name).map((f) => f.id);
    return { sections, followed };
  });

  ipcMain.handle("followSections", async (_e, sourceId: string, ids: string[]) => {
    if (!Array.isArray(ids)) return;
    const wanted = ids.filter((i) => typeof i === "string");
    // Save the chosen sections themselves too, so they resolve if the discovery cache is lost.
    const known = [...(await sectionsFor(sourceId, sectionDeps())), ...(store.getFollowedSections()[sourceId] ?? [])];
    store.setFollowed(sourceId, wanted, known.filter((s) => wanted.includes(s.id)));
  });

  ipcMain.handle("fetchFeed", async (_e, feedId: string) => {
    const feed = followedFeeds().find((f) => f.id === feedId);
    if (!feed) return { ok: false, items: [], error: "Unknown feed." };
    try {
      // The feed's deadline starts when its turn comes, not while it waits for it.
      const load = () => fetchFeed(feed, newsSession(), (url, signal) => loadPageHtml(url, newsSession(), { budgetMs: FEED_TIMEOUT_MS, signal }));
      return { ok: true, items: await polite.visit(feed.url || feed.homepage, load) };
    } catch (err) {
      return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("extract", async (e, url: string) => {
    if (!/^https?:/.test(url)) return { ok: false, error: "Not a web address." };
    const station = knownStation(url);
    if (station) return { ok: true, article: radioArticle(station) };
    const channel = knownChannel(url);
    if (channel) return { ok: true, article: tvArticle(channel) };
    const stored = await libraryReady();
    const cached = stored ? await store.getArticle(store.articleIdFor(url)) : null;
    if (cached && cached.blocks.length > 0) {
      if (fromMain(e)) articleOpened(cached.id);
      return { ok: true, article: cached };
    }

    // The reader is waiting for this one: it goes ahead of the site's feeds still queued.
    const read = () => polite.visit(url, () => extractArticle(url, newsSession(), allSources().sites), { urgent: true });
    let result = await read();
    // Logged out? If logins came from a browser before, refresh them and retry once.
    const browser = store.getLoginBrowser() as Browser | null;
    if (result.ok && result.paywalled && browser && BROWSERS.includes(browser)) {
      try {
        await importBrowserLogins(browser, newsSession(), reimportHosts());
        result = await read();
      } catch {
        // Keep the preview result; the paywall notice offers the manual options.
      }
    }
    if (stored && result.ok && result.article && !result.paywalled) {
      await store.saveArticle(result.article);
      if (fromMain(e)) articleOpened(result.article.id);
    }
    return result;
  });

  // Sources the user adds by URL. `discoverSource` previews; `addSource` saves.
  ipcMain.handle("discoverSource", async (_e, input: string) => {
    try {
      return { ok: true, source: await polite.visit(/^https?:\/\//.test(input) ? input : `https://${input}`, () => discoverSource(input, newsSession())) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle("addSource", (_e, src: { name: string; lang: Lang; homepage: string; hosts: string[]; feedUrl: string; catalogId?: string; feeds?: { name: string; url: string }[] }) => {
    const homepage = new URL(src.homepage).origin + "/";
    const hosts = hostsForHomepage(homepage); // throws for Google
    const id = src.catalogId ? `cat-${src.catalogId}` : sourceIdFor(homepage);
    const entry: UserSource = {
      id,
      name: src.name.trim() || new URL(src.homepage).hostname,
      lang: src.lang,
      homepage,
      hosts,
      // One feed, named in the chrome's words (English in every language).
      feeds: src.feeds ?? [{ name: LATEST_FEED_NAME, url: src.feedUrl }],
      catalogId: src.catalogId,
    };
    store.saveUserSources([...store.listUserSources().filter((s) => s.id !== id), entry]);
    void sidecar.ensureDictionary(entry.lang); // saving the source is what asks for its dictionary
    return entry;
  });
  ipcMain.handle("catalog", () => {
    const added = new Set(store.listUserSources().map((s) => s.catalogId).filter(Boolean));
    return CATALOG.map((c) => ({ ...c, added: added.has(c.id) }));
  });
  ipcMain.handle("addCatalogSource", (_e, catalogId: string) => {
    const c = CATALOG.find((x) => x.id === catalogId);
    if (!c) return null;
    const entry: UserSource = { id: `cat-${c.id}`, name: c.name, lang: c.lang, homepage: c.homepage, hosts: c.hosts, feeds: c.feeds, catalogId: c.id };
    store.saveUserSources([...store.listUserSources().filter((s) => s.id !== entry.id), entry]);
    void sidecar.ensureDictionary(entry.lang);
    return entry;
  });
  ipcMain.handle("removeSource", (_e, id: string) => {
    store.saveUserSources(store.listUserSources().filter((s) => s.id !== id));
  });

  ipcMain.handle("stations", () => savedStations());
  ipcMain.handle("saveStation", (_e, s: Station, lang: string) => {
    if (!isValidStation(s) || typeof lang !== "string") return savedStations();
    const list = saveStation(savedStations(), s, lang);
    store.saveStations(list);
    void sidecar.ensureDictionary(lang);
    return list;
  });
  ipcMain.handle("previewStation", (_e, s: Station) => {
    if (!isValidStation(s)) return;
    // Trying a station downloads nothing: its dictionary is fetched when it is saved.
    previewStations.set(s.url, { ...s, lang: s.languages[0] ?? "en" });
  });
  ipcMain.handle("removeStation", (_e, id: string) => {
    const list = removeStation(savedStations(), id);
    store.saveStations(list);
    return list;
  });
  // Only the main window manages channels or makes Readr fetch anything for them.
  ipcMain.handle("channels", () => savedChannels());
  ipcMain.handle("saveChannel", (e, c: Channel, lang: string) => {
    if (!fromMain(e) || !isValidChannel(c) || !isPublicStreamUrl(c.url) || typeof lang !== "string") return savedChannels();
    const list = saveChannel(savedChannels(), cleanChannel(c), lang);
    store.saveChannels(list);
    void sidecar.ensureDictionary(lang);
    return list;
  });
  ipcMain.handle("removeChannel", (e, id: string) => {
    if (!fromMain(e)) return savedChannels();
    const list = removeChannel(savedChannels(), id);
    store.saveChannels(list);
    return list;
  });
  ipcMain.handle("previewChannel", (e, c: Channel) => {
    if (!fromMain(e) || !isValidChannel(c) || !isPublicStreamUrl(c.url)) return;
    previewChannels.set(c.url, { ...cleanChannel(c), lang: c.languages[0] ?? "en" });
  });
  ipcMain.handle("tvSearch", async (e, q: TvQuery) => {
    if (!fromMain(e)) return { channels: [], countries: [] };
    tvIndex ??= createTvIndex({
      dir: store.tvCacheDir(),
      now: Date.now,
      fetchJson: async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
    });
    const all = await tvIndex();
    const query: TvQuery = { language: typeof q?.language === "string" ? q.language : "", country: typeof q?.country === "string" ? q.country : "", name: typeof q?.name === "string" ? q.name.slice(0, 100) : "" };
    const inLanguage = query.language ? all.filter((c) => c.languages.includes(query.language!)) : all;
    return { channels: searchChannels(all, query), countries: [...new Set(inLanguage.map((c) => c.country).filter(Boolean))].sort() };
  });
  // Only a saved or previewed channel's playlist is fetched (plainly: no spoofed headers).
  // null: the playlist has no audio-only variant. A network failure rejects, so the renderer can try again later.
  ipcMain.handle("tvAudioOnly", async (e, url: string) => {
    if (!fromMain(e) || typeof url !== "string" || !knownChannel(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const variant = audioOnlyVariant(await res.text(), res.url || url);
    return variant && isHttpUrl(variant) && isPublicStreamUrl(variant) ? variant : null;
  });
  ipcMain.handle("radioSearch", (_e, q) => sidecar.radioSearch(q));
  ipcMain.handle("radioCountries", () => sidecar.radioCountries());
  ipcMain.handle("radioLanguages", () => sidecar.radioLanguages());

  // Only the main window starts (or retries) the upgrade; it passes the app's language.
  ipcMain.handle("library:state", (e, currentLang: unknown) =>
    fromMain(e) ? libraryStartup.state(typeof currentLang === "string" ? currentLang : "") : libraryStartup.settled(),
  );
  ipcMain.handle("activity:today", async (e) => {
    const db = fromMain(e) ? await libraryStartup.database() : null;
    return db ? activity.today(db, new Date()) : { reviews: 0, listenMinutes: 0 };
  });
  ipcMain.handle("library:retryUpgrade", (e) => (fromMain(e) ? libraryStartup.retry() : libraryStartup.settled()));
  ipcMain.handle("library:showFolder", async (e) => {
    if (!fromMain(e)) return;
    fs.mkdirSync(store.libraryDir(), { recursive: true });
    await shell.openPath(store.libraryDir());
  });
  // Writes go to the store, which refuses them while the library is unavailable.
  ipcMain.handle("library", async () => ((await libraryReady()) ? store.listArticles() : []));
  ipcMain.handle("getArticle", async (_e, id: string) => ((await libraryReady()) ? store.getArticle(id) : null));
  ipcMain.handle("updateArticle", async (e, id: string, patch: Partial<Article>) => {
    if (!fromMain(e)) return;
    await libraryReady();
    return store.updateArticle(id, patch);
  });
  ipcMain.handle("deleteArticle", async (e, id: string) => {
    if (!fromMain(e)) return;
    await libraryReady();
    return store.deleteArticle(id);
  });

  // Live articles are never stored; their translations last for the session.
  const liveTranslations = new Map<string, string>();
  const liveHistory = new Map<string, string[]>();
  ipcMain.handle("translate", async (_e, articleId: string, sentences: string[], src: string, tgt: string) => {
    if (src === tgt) return Object.fromEntries(sentences.map((s) => [s, s])); // nothing to translate
    const article = (await libraryReady()) ? await store.getArticle(articleId) : null;
    const known = article ? translationsFor(article, tgt) : {};
    const have = (s: string) => known[s] || liveTranslations.get(`${src}|${tgt}|${s}`) || undefined;
    // Context comes from the stored article's sentence order, or the order passed in.
    let order: string[];
    if (article) order = [article.title, ...article.blocks.flatMap((b) => b.sentences)].filter(Boolean);
    else {
      order = appendHistory(liveHistory.get(articleId) ?? [], sentences);
      liveHistory.set(articleId, order);
    }
    const missing = [...new Set(sentences.filter((s) => have(s) === undefined))];
    const fresh: Record<string, string> = {};
    const BATCH = 24;
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const context = chunk.map((s) => contextFor(order, order.indexOf(s)));
      const out = await sidecar.translate(chunk, src, tgt, context);
      Object.assign(fresh, usableTranslations(chunk, out));
    }
    if (article) {
      if (Object.keys(fresh).length) await store.putTranslations(articleId, tgt, fresh);
    } else {
      for (const [s, t] of Object.entries(fresh)) liveTranslations.set(`${src}|${tgt}|${s}`, t);
      // A live transcript keeps them with its sentences (a past one's, or the session playing).
      if (Object.keys(fresh).length) void keepLiveTranslations(articleId, tgt, fresh);
    }
    return Object.fromEntries(sentences.map((s) => [s, fresh[s] ?? have(s) ?? ""]));
  });

  // The right-click menu's Translate and Add to flashcards, from the main or the floating window.
  const fromReader = (e: Electron.IpcMainInvokeEvent) => fromMain(e) || isFloatingSender(e);
  ipcMain.handle("phrase", (e, lang: unknown, sentence: unknown, start: unknown, end: unknown) => {
    if (!fromReader(e) || typeof lang !== "string" || typeof sentence !== "string" || sentence.length > 2000) return null;
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (start as number) >= (end as number) || (end as number) > sentence.length) return null;
    // The reader is waiting on this: a dictionary that doesn't answer soon counts as not ready.
    return sidecar.phrase(lang, sentence, start as number, end as number, 8000);
  });
  ipcMain.handle("translateSelection", async (e, lang: unknown, tgt: unknown, text: unknown, context: unknown): Promise<SelectionTranslation> => {
    const unavailable = { ok: false, reason: "unavailable" } as const;
    if (!fromReader(e) || typeof lang !== "string" || typeof tgt !== "string" || typeof text !== "string" || typeof context !== "string") return unavailable;
    if (!text.trim() || translationPlan(lang, tgt, languageInfo(lang).translate && languageInfo(tgt).translate) !== "ok") return unavailable;
    try {
      // The sentence (or sentences) is the context, and the result is never cached: words mean what their sentence makes them mean.
      const [out] = await sidecar.translate([text.slice(0, 2000)], lang, tgt, context.trim() ? [[context.slice(0, 4000)]] : [], { cache: false });
      return out?.trim() ? { ok: true, text: out.trim() } : { ok: false, reason: "empty" };
    } catch (err) {
      return err instanceof Error && err.message.startsWith("No translation for") ? unavailable : { ok: false, reason: "offline" };
    }
  });

  ipcMain.handle("lookup", (_e, word: string, sentence: string, lang: string, tgt: string, offset?: number) =>
    sidecar.lookup(word, sentence, lang, tgt, typeof offset === "number" ? offset : undefined),
  );
  ipcMain.handle("warmAnalysis", (_e, lang: string) => (typeof lang === "string" ? sidecar.warmAnalysis(lang) : undefined));
  ipcMain.handle("sidecarStatus", () => sidecar.sidecarStatus());
  ipcMain.handle("ttsStatus", () => sidecar.ttsStatus());
  ipcMain.handle("speak", (_e, text: string, lang: string, voice: string, quality: "fast" | "best") =>
    sidecar.speak(String(text).slice(0, 2000), lang, voice, quality === "best" ? "best" : "fast"),
  );
}

// One Readr at a time: launching it again brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  // Run from the project (not packaged), the Dock would show Electron's icon.
  const icon = path.join(app.getAppPath(), "build", "icon.png");
  if (!app.isPackaged && fs.existsSync(icon)) app.dock?.setIcon(icon);
  configureSession(newsSession());
  libraryStartup.open(); // the upgrade itself runs when the window asks (it knows the app's language)
  libraryStartup.startAfter(15_000); // ...or anyway, should the window never load
  registerIpc();
  registerCardsIpc({
    database: () => libraryStartup.database(),
    fromMain,
    fromFloating: isFloatingSender,
    changed: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send("cards:changed"),
    clipFor: (id) => liveClips.clip(id),
    chooseExportFolder: async () => {
      const options: Electron.OpenDialogOptions = {
        title: "Export cards for Anki",
        message: "Choose a folder for the cards file and their audio.",
        buttonLabel: "Export",
        defaultPath: app.getPath("documents"),
        properties: ["openDirectory", "createDirectory"],
      };
      const r = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
  });
  registerLiveHistoryIpc({ database: () => libraryStartup.database(), fromMain });
  registerSelectionState((e) => fromMain(e) || isFloatingSender(e));
  registerLiveIpc(() => mainWindow, knownLive, () => libraryStartup.current());
  void pruneLive();
  setInterval(() => void pruneLive(), PRUNE_EVERY_MS).unref();
  registerFloatingIpc({
    getMain: () => mainWindow,
    fromMain,
    preload: path.join(__dirname, "preload.js"),
    devUrl: DEV_URL,
    indexHtml: path.join(__dirname, "..", "..", "dist", "index.html"),
    hidden: Boolean(process.env.READR_HIDDEN),
    onCreate: (w) => attachSelectionMenu(w).catch((err) => console.error("The right-click menu couldn't load:", err)),
  });
  void sidecar.startSidecar().then(() => {
    // The packaged app's smoke test (scripts/smoke-packaged.mjs) asks the helpers directly.
    if (process.env.READR_SMOKE) console.log("SMOKE " + JSON.stringify(sidecar.helperAddresses()));
  });
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Quitting waits for the database to close (its last writes checkpointed), then exits (with process.exitCode,
// which the test harnesses set to report their checks).
let quitting = false;
app.on("before-quit", (e) => {
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  closeFloating();
  const liveEnded = stopLive();
  stopModel();
  sidecar.stopSidecar();
  // The live session ends (its last sentences saved) before the database closes. Neither may keep
  // the app from quitting.
  const closeTimeout = new Promise<void>((resolve) => setTimeout(resolve, 3000).unref());
  Promise.race([liveEnded.catch(() => undefined).then(() => libraryStartup.close()), closeTimeout])
    .catch((err) => console.error("Closing the library failed:", err))
    .finally(() => app.exit(Number(process.exitCode ?? 0)));
});
