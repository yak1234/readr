// Article extraction. A hidden BrowserWindow in the logged-in session loads the
// page as you; we inject Mozilla Readability and pull out clean blocks of text.

import { BrowserWindow, Session } from "electron";
import fs from "node:fs";
import type { Article, Block, ExtractResult, Lang } from "../shared/types";
import { splitSentences } from "../shared/segment";
import { articleIdFor } from "./store";
import { siteForUrl } from "./sites";

let readabilitySource: string | null = null;
function getReadabilitySource(): string {
  if (!readabilitySource) {
    readabilitySource = fs.readFileSync(require.resolve("@mozilla/readability/Readability.js"), "utf8");
  }
  return readabilitySource;
}

// Runs inside the article page. Must be self-contained and return JSON-safe data.
const PAGE_SCRIPT = String.raw`
(() => {
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  const bodyText = document.body ? document.body.innerText : "";
  const paywallPhrases = [
    "Il vous reste", "La suite est réservée aux abonnés", "Cet article est réservé aux abonnés",
    "réservé à nos abonnés", "Déjà abonné ?", "Pour lire la suite", "Article réservé aux abonnés",
  ];

  const doc = document.cloneNode(true);
  // Site chrome Readability sometimes keeps.
  doc.querySelectorAll([
    "aside", "nav", "footer", "form", "figure figcaption button", ".article__status", ".inread",
    ".services", ".meta__social", ".paywall", "[class*='newsletter']", "[class*='Newsletter']",
    "[class*='related']", "[class*='teaser']", "[data-module='inread']", "script", "style", "noscript",
  ].join(",")).forEach((el) => {
    // Class-substring selectors can hit the page itself (Le Monde's <body> has
    // "lmd-has-new-teaser"); removing that would leave nothing to read.
    if (el !== doc.body && el !== doc.documentElement) el.remove();
  });
  // When the site marks its article body, read only that. Otherwise a short
  // body (a paywall preview) loses to menus and footers.
  const marked = doc.querySelector("article.article__content, [itemprop='articleBody']");
  if (marked && marked.querySelectorAll("p").length >= 1) doc.body.replaceChildren(marked);

  const parsed = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse();
  if (!parsed) return { ok: false, error: "Readability could not find an article on this page." };

  const container = document.createElement("div");
  container.innerHTML = parsed.content || "";
  const junk = /^(Lire aussi|Lire l[’']|Lire la |Lire le |Lire notre|Lire nos|Lire notre|Newsletter|Abonnez-vous|Découvrir les offres|Vous pouvez lire Le Monde|Lecture du Monde en cours|Article réservé)/i;
  const blocks = [];
  container.querySelectorAll("p, h2, h3, h4, blockquote, li").forEach((el) => {
    if (el.closest("li") && el.tagName !== "LI") return;
    if (el.tagName === "P" && el.closest("blockquote")) return;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 2 || junk.test(text)) return;
    const type = /^H\d$/.test(el.tagName) ? "h" : el.tagName === "BLOCKQUOTE" ? "q" : el.tagName === "LI" ? "li" : "p";
    blocks.push({ type, text });
  });

  return {
    ok: true,
    title: meta("meta[property='og:title']") || parsed.title || document.title,
    subtitle: meta("meta[property='og:description']") || meta("meta[name='description']") || parsed.excerpt || "",
    author: parsed.byline || meta("meta[name='author']") || meta("meta[property='article:author']") || "",
    published: meta("meta[property='article:published_time']") || meta("meta[name='date']") || "",
    image: meta("meta[property='og:image']") || "",
    siteName: meta("meta[property='og:site_name']") || parsed.siteName || location.hostname,
    lang: (document.documentElement.lang || parsed.lang || "").slice(0, 2).toLowerCase(),
    paywallHint: paywallPhrases.some((p) => bodyText.includes(p)),
    blocks,
  };
})();
`;

function waitForLoad(win: BrowserWindow, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out loading the page.")), timeoutMs);
    win.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      resolve();
    });
    win.webContents.once("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted by a redirect; keep waiting
      clearTimeout(timer);
      reject(new Error(`Could not load the page (${desc}).`));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export async function extractArticle(url: string, session: Session): Promise<ExtractResult> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      images: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  try {
    const loaded = waitForLoad(win, 45_000);
    await win.loadURL(url).catch(() => undefined); // errors surface through waitForLoad
    await loaded;
    await sleep(1200); // let late hydration finish

    const raw = await win.webContents.executeJavaScript(`${getReadabilitySource()}\n${PAGE_SCRIPT}`, true);
    if (!raw?.ok) return { ok: false, error: raw?.error ?? "Extraction failed." };

    const finalUrl = win.webContents.getURL() || url;
    const lang: Lang = raw.lang === "en" || raw.lang === "ar" ? raw.lang : "fr";
    const blocks: Block[] = (raw.blocks as { type: Block["type"]; text: string }[])
      .map((b) => ({ type: b.type, sentences: b.type === "h" ? [b.text] : splitSentences(b.text, lang) }))
      .filter((b) => b.sentences.length > 0);

    const wordCount = blocks.reduce((n, b) => n + b.sentences.join(" ").split(/\s+/).length, 0);
    const site = siteForUrl(finalUrl);
    const article: Article = {
      id: articleIdFor(finalUrl),
      url: finalUrl,
      source: site?.name ?? raw.siteName ?? new URL(finalUrl).hostname,
      title: raw.title,
      subtitle: raw.subtitle,
      author: raw.author,
      date: formatDate(raw.published),
      readingTime: Math.max(1, Math.round(wordCount / 200)),
      imageUrl: raw.image,
      language: lang,
      blocks,
      translations: {},
      progress: 0,
      savedAt: new Date().toISOString(),
    };

    // A short body plus paywall wording usually means we are not logged in.
    const paywalled = Boolean(raw.paywallHint) && wordCount < 600;
    return { ok: true, article, paywalled };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    win.destroy();
  }
}
