// Browser checks: the "verifying your browser" page some sites (through Fastly, Cloudflare and the like) show
// before the real one. Readr loads pages in a real Chromium, as the reader, so such a check normally passes by
// itself within seconds and the real page follows. This file says what a check page looks like and waits for
// it to pass. Readr never answers a check for the reader: one that doesn't pass by itself is shown to them.

import type { WebContents } from "electron";
import pWaitFor from "p-wait-for";

/** Shown when a check didn't pass by itself. */
export const HUMAN_CHECK = "This site asks visitors to confirm they're human. Open it once, pass the check, and Readr will try again.";

/** How long a check is given to pass by itself. */
export const CHECK_WAIT_MS = Number(process.env.READR_CHECK_WAIT_MS) || 20_000;

/** What a page shows: its title and its visible text. */
export interface PageLook {
  title: string;
  text: string;
}

/** A check page is short; a real page that happens to mention one of the phrases is not. */
export const CHECK_MAX_CHARS = 1500;

const TITLES = /^(Client Challenge|Just a moment|Un instant|Attention Required|Vérification|Checking your browser|Verifying you are human|Human Verification|Pardon Our Interruption|Access denied)/i;
const PHRASES = [
  /verifying your browser/i,
  /checking your browser/i,
  /verify(ing)? (that )?you are (a )?human/i,
  /enable javascript and cookies to continue/i,
  /a required part of this site couldn.t load/i,
];

/** Whether the page is a browser check (or a refusal) rather than the page asked for. */
export function looksLikeBrowserCheck({ title, text }: PageLook): boolean {
  if (text.length > CHECK_MAX_CHARS) return false;
  return TITLES.test(title.trim()) || PHRASES.some((p) => p.test(text));
}

const LOOK = `({ title: document.title, text: (document.body ? document.body.innerText : "").slice(0, ${CHECK_MAX_CHARS + 1}), ready: document.readyState === "complete" })`;

/** What the page shows now; null while it is navigating (a passed check reloads the page) or gone. */
async function look(wc: WebContents): Promise<(PageLook & { ready: boolean }) | null> {
  if (wc.isDestroyed()) return null;
  return wc.executeJavaScript(LOOK, true).catch(() => null);
}

/** Waits until the page is loaded and is not a browser check. False when the check is still there after
 * `timeoutMs` (or the page went away): it needs the reader. */
export async function waitPastCheck(wc: WebContents, timeoutMs = CHECK_WAIT_MS): Promise<boolean> {
  try {
    await pWaitFor(
      async () => {
        if (wc.isDestroyed()) throw new Error("The page was closed.");
        const page = await look(wc);
        return page !== null && page.ready && !looksLikeBrowserCheck(page);
      },
      { interval: 500, timeout: timeoutMs },
    );
    return true;
  } catch {
    return false; // timed out, or the page went away
  }
}
