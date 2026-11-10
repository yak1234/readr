// The floating player: a small frameless always-on-top window for whatever is
// playing (a radio station or the article being read aloud). It plays nothing
// itself: the main window keeps the audio, and pushes this window what to show
// (sentences, preview, translations, play state).

import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { FloatingCommand, FloatingState } from "../shared/types";
import { clampBounds, FLOATING_DEFAULT, FLOATING_MIN, onFloatingBringBack, onFloatingOpened, type MainWindowAction, type Rect } from "../shared/floating";

let win: BrowserWindow | null = null;
let last: FloatingState | null = null;

const boundsFile = () => path.join(app.getPath("userData"), "floating.json");

function loadBounds(): Partial<Rect> & { width: number; height: number } {
  let saved: Partial<Rect> | null = null;
  try {
    saved = JSON.parse(fs.readFileSync(boundsFile(), "utf8"));
  } catch {
    /* nothing saved yet */
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const b = saved && { x: num(saved.x), y: num(saved.y), width: num(saved.width) ?? FLOATING_DEFAULT.width, height: num(saved.height) ?? FLOATING_DEFAULT.height };
  return clampBounds(b, screen.getAllDisplays().map((d) => d.workArea));
}

function saveBounds(w: BrowserWindow) {
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(w.getBounds()));
  } catch {
    /* the position just won't be remembered */
  }
}

export interface FloatingOptions {
  getMain: () => BrowserWindow | null;
  /** Whether an IPC call comes from the main window (main.ts's check). */
  fromMain: (e: { sender: Electron.WebContents }) => boolean;
  preload: string;
  /** The dev server's address, or null when packaged. */
  devUrl?: string;
  indexHtml: string;
  /** Automated tests: the window must never be visible. */
  hidden: boolean;
  /** Each new floating window (it gets the right-click menu). */
  onCreate?: (w: BrowserWindow) => void;
}

/** Whether an IPC call comes from the floating captions window. */
export const isFloatingSender = (e: { sender: Electron.WebContents }) => Boolean(win && !win.isDestroyed() && e.sender === win.webContents);

export function closeFloating() {
  if (win && !win.isDestroyed()) win.close();
}

export function registerFloatingIpc(o: FloatingOptions) {
  // Carries out the decided actions. Automated runs never show or focus a window.
  const applyToMain = (actions: MainWindowAction[]) => {
    const main = o.getMain();
    if (!main || main.isDestroyed()) return;
    for (const a of actions) if (!o.hidden || a === "minimize" || a === "restore") main[a]();
  };
  const open = () => {
    const main = o.getMain();
    if (main && !main.isDestroyed()) applyToMain(onFloatingOpened({ minimized: main.isMinimized(), fullScreen: main.isFullScreen() }));
    if (win && !win.isDestroyed()) {
      if (!o.hidden) win.showInactive();
      return;
    }
    const w = new BrowserWindow({
      ...loadBounds(),
      minWidth: FLOATING_MIN.width,
      minHeight: FLOATING_MIN.height,
      frame: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: "Readr",
      backgroundColor: "#FAFAF7",
      acceptFirstMouse: true,
      webPreferences: { preload: o.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    win = w;
    if (o.hidden) w.setOpacity(0); // before it can ever be shown
    w.setAlwaysOnTop(true, "floating");
    w.setVisibleOnAllWorkspaces(true);
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (e, url) => {
      if (o.devUrl && url.startsWith(o.devUrl)) return;
      e.preventDefault();
    });
    let timer: NodeJS.Timeout | undefined;
    const remember = () => {
      clearTimeout(timer);
      timer = setTimeout(() => !w.isDestroyed() && saveBounds(w), 400);
    };
    w.on("resize", remember);
    w.on("move", remember);
    w.on("close", () => {
      clearTimeout(timer);
      saveBounds(w);
    });
    w.on("closed", () => {
      if (win === w) win = null;
    });
    o.onCreate?.(w);
    w.once("ready-to-show", () => w.showInactive());
    if (o.devUrl) w.loadURL(`${o.devUrl}?floating`);
    else w.loadFile(o.indexHtml, { query: { floating: "1" } });
  };

  const { fromMain } = o;
  const fromFloating = isFloatingSender;

  ipcMain.handle("floatingOpen", (e) => {
    if (fromMain(e)) open();
  });
  ipcMain.handle("floatingClose", (e) => {
    if (fromMain(e) || fromFloating(e)) closeFloating();
  });
  ipcMain.handle("floatingReady", (e) => (fromFloating(e) ? last : null));
  ipcMain.on("floating:push", (e, state: FloatingState) => {
    if (!fromMain(e)) return;
    last = state;
    // Nothing playing (the radio stopped, or read-aloud ended) leaves nothing to show.
    if (!state.kind) return closeFloating();
    if (win && !win.isDestroyed()) win.webContents.send("floating:state", state);
  });
  ipcMain.on("floating:command", (e, cmd: FloatingCommand) => {
    if (!fromFloating(e) || !cmd || typeof cmd.type !== "string") return;
    const main = o.getMain();
    if (!main) return;
    if (cmd.type === "open" || cmd.type === "more") applyToMain(onFloatingBringBack({ minimized: main.isMinimized() }));
    const safe: FloatingCommand | null =
      cmd.type === "toggle-play" || cmd.type === "toggle-translation" || cmd.type === "open" || cmd.type === "prev" || cmd.type === "next"
        ? { type: cmd.type }
        : cmd.type === "more"
          ? { type: "more", word: String(cmd.word).slice(0, 100), sentence: String(cmd.sentence).slice(0, 1000) }
          : null;
    if (safe) main.webContents.send("floating:command", safe);
  });
}
