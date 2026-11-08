import type { Feed, Site } from "../shared/types";

export const SITES: Site[] = [
  {
    id: "lemonde",
    name: "Le Monde",
    homepage: "https://www.lemonde.fr/",
    // Opening the homepage is the safest bet; the login link is in the header.
    loginUrl: "https://www.lemonde.fr/",
    hosts: ["lemonde.fr", "www.lemonde.fr"],
  },
  {
    id: "courrier",
    name: "Courrier International",
    homepage: "https://www.courrierinternational.com/",
    loginUrl: "https://www.courrierinternational.com/",
    hosts: ["courrierinternational.com", "www.courrierinternational.com"],
  },
  {
    id: "lefigaro",
    name: "Le Figaro",
    homepage: "https://www.lefigaro.fr/",
    loginUrl: "https://www.lefigaro.fr/",
    hosts: ["lefigaro.fr", "www.lefigaro.fr"],
  },
];

export const FEEDS: Feed[] = [
  {
    id: "lemonde-une",
    name: "À la une",
    source: "Le Monde",
    url: "https://www.lemonde.fr/rss/une.xml",
    homepage: "https://www.lemonde.fr/",
  },
  {
    id: "lemonde-international",
    name: "International",
    source: "Le Monde",
    url: "https://www.lemonde.fr/international/rss_full.xml",
    homepage: "https://www.lemonde.fr/international/",
  },
  {
    id: "courrier-all",
    name: "Tous les articles",
    source: "Courrier International",
    // Not hard-coded: discovered from the homepage's <link rel="alternate"> tag.
    url: "",
    homepage: "https://www.courrierinternational.com/",
  },
];

export function siteForUrl(url: string): Site | undefined {
  try {
    const host = new URL(url).hostname;
    return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  } catch {
    return undefined;
  }
}
