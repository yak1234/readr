import type { Feed, Section, Site } from "../shared/types";

export const SITES: Site[] = [
  {
    id: "lemonde",
    name: "Le Monde",
    homepage: "https://www.lemonde.fr/",
    // Opening the homepage is the safest bet; the login link is in the header.
    loginUrl: "https://www.lemonde.fr/",
    hosts: ["lemonde.fr", "www.lemonde.fr"],
    lang: "fr",
  },
  {
    id: "courrier",
    name: "Courrier International",
    homepage: "https://www.courrierinternational.com/",
    loginUrl: "https://www.courrierinternational.com/",
    hosts: ["courrierinternational.com", "www.courrierinternational.com"],
    lang: "fr",
  },
];

export const FEEDS: Feed[] = [
  {
    id: "lemonde-une",
    name: "À la une",
    source: "Le Monde",
    url: "https://www.lemonde.fr/rss/une.xml",
    homepage: "https://www.lemonde.fr/",
    lang: "fr",
  },
  {
    id: "lemonde-international",
    name: "International",
    source: "Le Monde",
    url: "https://www.lemonde.fr/international/rss_full.xml",
    homepage: "https://www.lemonde.fr/international/",
    lang: "fr",
  },
  {
    id: "courrier-all",
    name: "Tous les articles",
    source: "Courrier International",
    // Not hard-coded: discovered from the homepage's <link rel="alternate"> tag.
    url: "",
    homepage: "https://www.courrierinternational.com/",
    lang: "fr",
  },
];

const section = (site: string, slug: string, name: string, url: string): Section => ({ id: `${site}-${slug}`, name, url });
const lemonde = (slug: string, name: string) => section("lemonde", slug, name, `https://www.lemonde.fr/${slug}/rss_full.xml`);
const courrier = (slug: string, name: string) => section("courrier", slug, name, `https://www.courrierinternational.com/feed/rubrique/${slug}/rss.xml`);

/** Everything each built-in source offers, in picker order. Ids match FEEDS where
 * a feed already exists (the defaults). Every URL was checked to return items. */
export const SECTIONS: Record<string, Section[]> = {
  lemonde: [
    section("lemonde", "une", "À la une", "https://www.lemonde.fr/rss/une.xml"),
    lemonde("international", "International"),
    lemonde("politique", "Politique"),
    lemonde("economie", "Économie"),
    lemonde("societe", "Société"),
    lemonde("culture", "Culture"),
    lemonde("sport", "Sport"),
    lemonde("idees", "Idées"),
    lemonde("sciences", "Sciences"),
    lemonde("planete", "Planète"),
    lemonde("sante", "Santé"),
    lemonde("pixels", "Pixels"),
    lemonde("campus", "Campus"),
  ],
  courrier: [
    section("courrier", "all", "Tous les articles", "https://www.courrierinternational.com/feed/all/rss.xml"),
    courrier("france", "France"),
    courrier("economie", "Économie"),
    courrier("culture", "Culture"),
    courrier("expat", "Expat"),
  ],
};

export function siteForUrl(url: string, sites: Site[] = SITES): Site | undefined {
  try {
    const u = new URL(url);
    const matches = sites.filter((s) => s.hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)));
    // Several editions on one host (france24.com/fr/ and /ar/): longest homepage path wins.
    const pathOf = (s: Site) => new URL(s.homepage).pathname;
    return matches
      .filter((s) => u.pathname.startsWith(pathOf(s)))
      .sort((a, b) => pathOf(b).length - pathOf(a).length)[0] ?? matches[0];
  } catch {
    return undefined;
  }
}
