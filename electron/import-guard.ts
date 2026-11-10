// What the import dialog may ask for: only real registrable domains that the last
// browser listing returned. Anything else (a public suffix like "co.uk", a site that
// was never listed, "127.0.0.1:8080", "x.com/path") is dropped.

import { getDomain } from "tldts";
import { isBlockedHost } from "./cookie-policy";

export const isRegistrableDomain = (s: unknown): s is string =>
  typeof s === "string" && s === s.toLowerCase() && getDomain(s) === s && !isBlockedHost(s);

export function allowedSites(requested: unknown, listed: Iterable<string>): string[] {
  const set = new Set(listed);
  if (!Array.isArray(requested)) return [];
  return [...new Set(requested.filter((s): s is string => isRegistrableDomain(s) && set.has(s)))];
}
