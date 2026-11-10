// Sources the user added (by URL or from the catalogue), stored next to the
// library, merged with the built-in ones.

import { BrowserWindow, Session } from "electron";
import { hostsForHomepage } from "./cookie-policy";
import { CHECK_WAIT_MS, HUMAN_CHECK, waitPastCheck } from "./browser-check";
import crypto from "node:crypto";
import { normaliseLanguageTags } from "../shared/languages";
import type { DiscoveredSource, Feed, Site, UserSource } from "../shared/types";

export function sourceIdFor(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return `src-${crypto.createHash("sha1").update(host).digest("hex").slice(0, 10)}`;
}

export function mergeSources(sites: Site[], feeds: Feed[], user: UserSource[]): { sites: Site[]; feeds: Feed[] } {
  user = user.filter((u) => u.kind !== "video"); // video sources from older versions
  const extraSites: Site[] = user.map((u) => ({
    id: u.id,
    name: u.name,
    homepage: u.homepage,
    loginUrl: u.homepage,
    hosts: u.hosts,
    lang: u.lang,
    user: true,
    free: Boolean(u.catalogId),
  }));
  const extraFeeds: Feed[] = user.flatMap((u) =>
    u.feeds.map((f, i) => ({
      id: `${u.id}-${i}`,
      name: f.name,
      source: u.name,
      url: f.url,
      homepage: u.homepage,
      lang: u.lang,
      fromHomepage: !f.url,
    })),
  );
  return { sites: [...sites, ...extraSites], feeds: [...feeds, ...extraFeeds] };
}

/** Render a page in a hidden window of the logged-in session and return its
 * HTML. Used for sites that refuse plain HTTP requests. */
export async function loadPageHtml(url: string, session: Session, { budgetMs = 45_000, signal }: { budgetMs?: number; signal?: AbortSignal } = {}): Promise<string> {
  const end = Date.now() + budgetMs;
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, images: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const stop = () => !win.isDestroyed() && win.destroy();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out loading the page.")), budgetMs)),
    ]).catch((e) => {
      if (String(e?.message).includes("Timed out")) throw e; // ERR_ABORTED from redirects is fine
    });
    // Some sites show a browser check first ("Just a moment…"); a normal browser
    // passes it by itself within seconds, so wait for the real page.
    if (!(await waitPastCheck(win.webContents, Math.min(CHECK_WAIT_MS, Math.max(0, end - Date.now()))))) {
      throw new Error(HUMAN_CHECK);
    }
    await new Promise((r) => setTimeout(r, 800)); // late rendering
    return await win.webContents.executeJavaScript("document.documentElement.outerHTML", true);
  } finally {
    signal?.removeEventListener("abort", stop);
    stop();
  }
}

export type Discovered = DiscoveredSource; // feedUrl "" when the site advertises no RSS

/** Read a site's name, language and RSS link from its homepage. */
export async function discoverSource(input: string, session: Session): Promise<Discovered> {
  const homepage = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).origin + "/";
  const hosts = hostsForHomepage(homepage); // refuses Google before loading anything
  const html = await loadPageHtml(homepage, session);
  const attr = (re: RegExp) => html.match(re)?.[1]?.trim() ?? "";
  const name =
    attr(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) ||
    attr(/<title>([^<|–—-]+)/i) ||
    new URL(homepage).hostname.replace(/^www\./, "");
  const rssTag = html.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i)?.[0];
  const href = rssTag?.match(/href=["']([^"']+)["']/i)?.[1];
  const feedUrl = href ? new URL(href, homepage).toString() : "";
  let lang = detectLanguage(html);
  if (!lang && feedUrl) lang = detectLanguage("", await fetchText(feedUrl).catch(() => ""));
  return {
    name: name.replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'"),
    lang,
    homepage,
    hosts,
    feedUrl,
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  return res.ok ? await res.text() : "";
}

/** A site's language as an ISO code: its <html lang>, else its feed's <language>
 * ("ar-LB" and "es-ES" become "ar" and "es"). */
export function detectLanguage(html: string, feedXml?: string): string | null {
  const iso = (tag: string | undefined): string | null => {
    const t = tag?.trim().toLowerCase().replace(/_/g, "-");
    if (!t) return null;
    return normaliseLanguageTags(t)[0] ?? normaliseLanguageTags(t.split("-")[0])[0] ?? null;
  };
  return iso(html.match(/<html[^>]*\slang=["']([^"']+)/i)?.[1]) ?? iso(feedXml?.match(/<language>([^<]+)</i)?.[1]);
}
