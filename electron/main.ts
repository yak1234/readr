import { app, BrowserWindow, dialog, ipcMain, session as electronSession, shell, Session } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { Article, VocabEntry } from "../shared/types";
import { extractArticle } from "./extract";
import { fetchFeed } from "./feeds";
import { FEEDS, SITES } from "./sites";
import * as store from "./store";
import * as sidecar from "./sidecar";
import { BROWSERS, importBrowserLogins, type Browser } from "./browser-login";
import { extractVideo, registerVideoIpc, videoArticleId, youtubeId } from "./video";

const PARTITION = "persist:readr"; // cookies/logins survive restarts
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

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
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
  });

  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
}

/** A visible browser window in the shared news session. Resolves when closed. */
function openSiteWindow(url: string, title: string): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1180,
      height: 860,
      parent: mainWindow ?? undefined,
      title,
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
  });
}

function registerIpc() {
  ipcMain.handle("sites", () => SITES);

  ipcMain.handle("login", async (_e, siteId: string) => {
    const site = SITES.find((s) => s.id === siteId);
    if (!site) return;
    await openSiteWindow(site.loginUrl, `Sign in — ${site.name}`);
  });

  ipcMain.handle("importBrowserLogins", async (_e, browser: Browser) => {
    if (!BROWSERS.includes(browser)) return { ok: false, error: "Unknown browser." };
    try {
      const r = await importBrowserLogins(browser, newsSession(), SITES.flatMap((s) => s.hosts));
      if (r.imported > 0) store.setLoginBrowser(browser);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("openOriginal", async (_e, url: string) => {
    if (!/^https?:/.test(url)) return;
    await openSiteWindow(url, "Original article");
  });

  ipcMain.handle("feeds", () => FEEDS);

  ipcMain.handle("fetchFeed", async (_e, feedId: string) => {
    const feed = FEEDS.find((f) => f.id === feedId);
    if (!feed) return { ok: false, items: [], error: "Unknown feed." };
    try {
      return { ok: true, items: await fetchFeed(feed, newsSession()) };
    } catch (err) {
      return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("extract", async (_e, url: string) => {
    if (!/^https?:/.test(url)) return { ok: false, error: "Not a web address." };
    const videoId = youtubeId(url);
    if (videoId) {
      const cachedVideo = store.getArticle(videoArticleId(videoId));
      if (cachedVideo && cachedVideo.blocks.length > 0) return { ok: true, article: cachedVideo };
      const result = await extractVideo(url, newsSession());
      if (result.ok && result.article) store.saveArticle(result.article);
      return result;
    }
    const id = store.articleIdFor(url);
    const cached = store.getArticle(id);
    if (cached && cached.blocks.length > 0) return { ok: true, article: cached };

    let result = await extractArticle(url, newsSession());
    // Logged out? If logins came from a browser before, refresh them and retry once.
    const browser = store.getLoginBrowser() as Browser | null;
    if (result.ok && result.paywalled && browser && BROWSERS.includes(browser)) {
      try {
        await importBrowserLogins(browser, newsSession(), SITES.flatMap((s) => s.hosts));
        result = await extractArticle(url, newsSession());
      } catch {
        // Keep the preview result; the paywall notice offers the manual options.
      }
    }
    if (result.ok && result.article && !result.paywalled) store.saveArticle(result.article);
    return result;
  });

  ipcMain.handle("library", () => store.listArticles());
  ipcMain.handle("getArticle", (_e, id: string) => store.getArticle(id));
  ipcMain.handle("updateArticle", (_e, id: string, patch: Partial<Article>) => store.updateArticle(id, patch));
  ipcMain.handle("deleteArticle", (_e, id: string) => store.deleteArticle(id));

  ipcMain.handle("translate", async (_e, articleId: string, sentences: string[]) => {
    const article = store.getArticle(articleId);
    const known = article?.translations ?? {};
    const missing = [...new Set(sentences.filter((s) => !(s in known)))];
    const fresh: Record<string, string> = {};
    const BATCH = 24;
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const out = await sidecar.translate(chunk);
      chunk.forEach((s, j) => (fresh[s] = out[j] ?? ""));
    }
    if (article && Object.keys(fresh).length) store.updateArticle(articleId, { translations: fresh });
    const all = { ...known, ...fresh };
    return Object.fromEntries(sentences.map((s) => [s, all[s] ?? ""]));
  });

  ipcMain.handle("lookup", (_e, word: string, sentence: string) => sidecar.lookup(word, sentence));
  ipcMain.handle("sidecarStatus", () => sidecar.sidecarStatus());

  ipcMain.handle("vocab", () => store.listVocab());
  ipcMain.handle("addVocab", (_e, entry: Omit<VocabEntry, "id" | "addedAt">) => store.addVocab(entry));
  ipcMain.handle("updateVocab", (_e, id: string, patch: Partial<VocabEntry>) => store.updateVocab(id, patch));
  ipcMain.handle("removeVocab", (_e, id: string) => store.removeVocab(id));
  ipcMain.handle("exportVocab", async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export vocabulary for Anki",
      defaultPath: path.join(app.getPath("documents"), "readr-vocab.txt"),
      filters: [{ name: "Anki text import", extensions: ["txt", "tsv"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, store.vocabToTsv(store.listVocab()), "utf8");
    return result.filePath;
  });
}

app.whenReady().then(() => {
  configureSession(newsSession());
  registerIpc();
  registerVideoIpc(() => mainWindow, newsSession);
  sidecar.startSidecar();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => sidecar.stopSidecar());
