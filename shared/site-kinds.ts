// Suggesting which browser logins to import: a decision model labels each site
// ("news", "bank"…) from its homepage title; these helpers hold the rules around
// that label. Pure, so the dialog and the tests share them.

export type Kind = "news" | "media" | "finance" | "shopping" | "social" | "work" | "gov_health";
export type Probs = Partial<Record<Kind, number>>;
export interface SiteInfo { title: string; description: string }
export interface Classification { probs: Probs; title?: string }

export const QUESTION = {
  type: "choice",
  instructions: "What kind of website is this?",
  criteria: {
    news: "Newspaper, magazine, broadcaster or news site (public or private)",
    media: "Radio, podcast, music or video streaming",
    finance: "Bank, payments, insurance or investing",
    shopping: "Online shop, marketplace or classifieds",
    social: "Social network or messaging",
    work: "Email, cloud storage or work tools",
    gov_health: "Official government services: tax, benefits, health insurance, public administration portals",
  } satisfies Record<Kind, string>,
} as const;

export const KIND_LABEL: Record<Kind, string> = {
  news: "News", media: "Media", finance: "Finance", shopping: "Shopping", social: "Social", work: "Work", gov_health: "Government / health",
};

/** Ticking one of these asks for confirmation first. */
export const isSensitive = (kind: Kind | undefined) => kind === "finance" || kind === "gov_health" || kind === "work";

export const preTick = (probs: Probs | undefined) => (probs?.news ?? 0) + (probs?.media ?? 0) >= 0.6;

export function kindOf(probs: Probs | undefined): Kind | undefined {
  const entries = Object.entries(probs ?? {}) as [Kind, number][];
  return entries.sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Cookie names are never sent: they hurt accuracy in testing, and are private. */
export function stateFor(site: string, info: SiteInfo): string {
  return ["Website: https://www." + site + "/", info.title, info.description].filter(Boolean).join(" — ");
}

export function parseAnswer(json: unknown): Probs | null {
  const probs = (json as { answers?: { kind?: { probabilities?: Probs } } })?.answers?.kind?.probabilities;
  return probs && typeof probs === "object" ? probs : null;
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", auml: "ä", ccedil: "ç", icirc: "î", iuml: "ï", ocirc: "ô", ouml: "ö", ugrave: "ù", ucirc: "û", uuml: "ü", oelig: "œ",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", Ecirc: "Ê", Ocirc: "Ô",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeChar(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => safeChar(Number(d), m))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => NAMED[n] ?? m);
}
const safeChar = (code: number, fallback: string) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback);
const decode = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

export function parseHomepage(html: string): SiteInfo {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const tag = html.match(/<meta\b[^>]*\bname=["']description["'][^>]*>/i)?.[0] ?? "";
  // The value ends at the matching quote, so an apostrophe inside "…" stays in the text.
  const description = tag.match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find((v) => v !== undefined) ?? "";
  return { title: decode(title).slice(0, 200), description: decode(description).slice(0, 300) };
}

export interface Row {
  site: string;
  cookies: number;
  tick: boolean;
  kind?: Kind;
  sensitive: boolean;
}

/** `always`: the user's sources, saved stations' homepages and catalogue sites.
 * `chosen`: the sites ticked last time. Everything else follows the model. */
export function suggestRows(
  sites: { site: string; cookies: number }[],
  o: { always: string[]; chosen: string[]; classes: Record<string, Classification | undefined> },
): Row[] {
  const always = new Set(o.always);
  const chosen = new Set(o.chosen);
  return sites.map(({ site, cookies }) => {
    const probs = o.classes[site]?.probs;
    const kind = kindOf(probs);
    return { site, cookies, kind, sensitive: isSensitive(kind), tick: always.has(site) || chosen.has(site) || preTick(probs) };
  });
}

export interface ClassifyDeps {
  /** False when the model can't run; nothing is fetched then. */
  available?: () => Promise<boolean>;
  fetchInfo: (site: string) => Promise<SiteInfo>;
  classify: (state: string) => Promise<Probs | null>;
}

/** Classify the sites not yet in `cache`; returns only the new results. A site whose
 * homepage can't be read is still classified from its name alone. */
export async function classifyNew(sites: string[], cache: Record<string, Classification | undefined>, deps: ClassifyDeps): Promise<Record<string, Classification>> {
  const todo = sites.filter((s) => !cache[s]);
  const out: Record<string, Classification> = {};
  if (todo.length === 0 || (deps.available && !(await deps.available()))) return out;
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const site = todo[next++];
      const info = await deps.fetchInfo(site).catch(() => ({ title: "", description: "" }));
      const probs = await deps.classify(stateFor(site, info)).catch(() => null);
      if (probs) out[site] = { probs, title: info.title || undefined };
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
  return out;
}
