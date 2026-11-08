// "Use my browser's login": copies your existing logins for the news sites from
// your everyday browser into Readr's session, so sites you sign in to with
// "Sign in with Google" (which Google won't allow inside an app) work in Readr.
//
// yt-dlp does the reading, since it already knows each browser's cookie store
// and how to decrypt it (macOS asks once for Keychain access). Only cookies for
// the configured sites are imported; the temporary export is deleted at once.

import { Session } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ytDlp } from "./video";

export const BROWSERS = ["vivaldi", "safari", "chrome", "brave", "firefox", "edge", "opera"] as const;
export type Browser = (typeof BROWSERS)[number];

interface JarCookie {
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: number;
  name: string;
  value: string;
}

/** Netscape cookies.txt, as written by yt-dlp. */
export function parseCookieJar(text: string): JarCookie[] {
  const out: JarCookie[] = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#") || !line.trim()) {
      continue;
    }
    const f = line.split("\t");
    if (f.length < 7) continue;
    out.push({ domain: f[0], path: f[2] || "/", secure: f[3] === "TRUE", expires: Number(f[4]) || 0, name: f[5], value: f[6], httpOnly });
  }
  return out;
}

const matchesHost = (domain: string, hosts: string[]) => {
  const d = domain.replace(/^\./, "");
  return hosts.some((h) => d === h || d.endsWith(`.${h}`) || h.endsWith(`.${d}`));
};

function exportJar(browser: Browser, jar: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // yt-dlp needs a URL to run; it saves the cookie jar even though this one
    // isn't a video.
    execFile(
      ytDlp(),
      ["--cookies-from-browser", browser, "--cookies", jar, "--simulate", "--no-warnings", "--quiet", "https://www.lemonde.fr/"],
      { timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (fs.existsSync(jar)) return resolve();
        const line = stderr.split("\n").find((l) => l.startsWith("ERROR")) ?? err?.message ?? "unknown error";
        reject(new Error(`Couldn't read ${browser}'s logins: ${line.replace(/^ERROR:\s*/, "")}`));
      },
    );
  });
}

export async function importBrowserLogins(browser: Browser, session: Session, hosts: string[]): Promise<{ imported: number; domains: string[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readr-cookies-"));
  const jar = path.join(dir, "jar.txt");
  try {
    await exportJar(browser, jar);
    const wanted = parseCookieJar(fs.readFileSync(jar, "utf8")).filter((c) => matchesHost(c.domain, hosts));
    const domains = new Set<string>();
    let imported = 0;
    for (const c of wanted) {
      const host = c.domain.replace(/^\./, "");
      try {
        await session.cookies.set({
          url: `https://${host}${c.path}`,
          name: c.name,
          value: c.value,
          domain: c.domain.startsWith(".") ? c.domain : undefined,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          // Cookies without an expiry would vanish when Readr quits; keep them a year.
          expirationDate: c.expires > 0 ? c.expires : Date.now() / 1000 + 365 * 24 * 3600,
        });
        imported++;
        domains.add(host.replace(/^www\./, ""));
      } catch {
        // A cookie Chromium rejects (odd attributes) is skipped; the rest still work.
      }
    }
    await session.cookies.flushStore();
    return { imported, domains: [...domains].sort() };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
