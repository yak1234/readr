// The right-click menu, from electron-context-menu: on selected text, Translate and Add to flashcards
// come first, then the package's own items (Copy, Look Up). Choosing one sends `menu:translate` /
// `menu:add-card` back to that window, which checks its selection again and does the work.
//
// The items are enabled from the menu's own selection text (it has letters), so a right-click that
// selects a word as it opens the menu works at once. The renderer's report is only a hint: when it is
// about this very selection and says it crosses sentences, Add to flashcards is off.

import { app, ipcMain, type BrowserWindow, type MenuItemConstructorOptions, type WebContents } from "electron";
import type contextMenuFn from "electron-context-menu" with { "resolution-mode": "import" };
import type { MenuAction } from "../shared/types";

/** What a window's renderer last said about its selection. */
export interface ReportedSelection {
  text: string;
  /** It lies within one finished sentence, so it could become a card. */
  add: boolean;
}

const LETTER = /\p{L}/u;
const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** Readr's items, put before the package's own: none without selected text, both off without letters. */
export function selectionItems(selectionText: string, reported: ReportedSelection | null, run: (action: MenuAction) => void): MenuItemConstructorOptions[] {
  if (!selectionText.trim()) return [];
  const letters = LETTER.test(selectionText);
  const crossesSentences = reported !== null && same(reported.text, selectionText) && !reported.add;
  return [
    { id: "readr-translate", label: "Translate", enabled: letters, click: () => run("translate") },
    { id: "readr-add-card", label: "Add to flashcards", enabled: letters && !crossesSentences, click: () => run("add-card") },
    { type: "separator" },
  ];
}

const reports = new WeakMap<WebContents, ReportedSelection>();

/** The items for a right-click on `selectionText` in `wc`; choosing one sends it the action. */
export function itemsFor(wc: WebContents, selectionText: string): MenuItemConstructorOptions[] {
  return selectionItems(selectionText, reports.get(wc) ?? null, (action) => {
    if (!wc.isDestroyed()) wc.send(`menu:${action}`);
  });
}

/** Listens for `selection:state` from the windows `allowed` accepts. */
export function registerSelectionState(allowed: (e: { sender: WebContents }) => boolean): void {
  ipcMain.on("selection:state", (e, state: unknown) => {
    if (!allowed(e) || typeof state !== "object" || state === null) return;
    const { text, add } = state as Record<string, unknown>;
    if (typeof text === "string") reports.set(e.sender, { text: text.slice(0, 5000), add: add === true });
  });
}

// The package is ESM only and the main process is CommonJS: TypeScript (module NodeNext) leaves this
// import() as it is, so Node loads the ES module.
let loading: Promise<typeof contextMenuFn> | undefined;
const contextMenu = () => (loading ??= import("electron-context-menu").then((m) => m.default));

/** Gives `win` the right-click menu. Inspect Element only in development. */
export async function attachSelectionMenu(win: BrowserWindow): Promise<void> {
  const create = await contextMenu();
  if (win.isDestroyed()) return;
  const wc = win.webContents;
  create({
    window: win,
    showSearchWithGoogle: false,
    showInspectElement: !app.isPackaged,
    // Not in text fields: Readr's items are for the text being read.
    prepend: (_actions, params) => (params.isEditable ? [] : itemsFor(wc, params.selectionText)),
  });
}
