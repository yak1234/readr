// Which browser cookies may be copied into Readr. Google and YouTube are always
// refused: Google blocks sign-in inside apps on purpose, and Readr respects that.

const BLOCKED = /(^|\.)(google\.[a-z.]+|youtube\.com|youtu\.be|youtube-nocookie\.com|gstatic\.com|googleusercontent\.com|googlevideo\.com|ggpht\.com)$/i;

const bare = (d: string) => d.replace(/^\./, "").toLowerCase();

export const isBlockedHost = (host: string) => BLOCKED.test(bare(host));

/** A cookie for `domain` may be imported when it belongs to one of `hosts`
 * (the domain itself or a parent of it, never a bare TLD), and is not Google. */
export function cookieAllowed(domain: string, hosts: string[]): boolean {
  const d = bare(domain);
  if (!d.includes(".") || isBlockedHost(d)) return false;
  return hosts.some((h) => {
    const host = bare(h);
    if (isBlockedHost(host)) return false;
    return d === host || d.endsWith(`.${host}`) || host.endsWith(`.${d}`);
  });
}

/** A source's hosts, derived from its homepage (not trusted from the UI). */
export function hostsForHomepage(homepage: string): string[] {
  const host = new URL(homepage).hostname.toLowerCase();
  if (isBlockedHost(host)) throw new Error("Google and YouTube can't be added as sources this way.");
  return [...new Set([host.replace(/^www\./, ""), host])];
}
