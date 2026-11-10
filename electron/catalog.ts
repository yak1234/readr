// Free sources Readr suggests, no login needed. Feed URLs checked on 2026-11-08.

import type { CatalogSource } from "../shared/types";

export const CATALOG: CatalogSource[] = [
  // ---- français
  { id: "france24-fr", name: "France 24", lang: "fr", note: "Gratuit · international",
    homepage: "https://www.france24.com/fr/", hosts: ["france24.com", "www.france24.com"],
    feeds: [{ name: "À la une", url: "https://www.france24.com/fr/rss" }] },
  { id: "rfi-fr", name: "RFI", lang: "fr", note: "Gratuit · monde et Afrique",
    homepage: "https://www.rfi.fr/fr/", hosts: ["rfi.fr", "www.rfi.fr"],
    feeds: [{ name: "À la une", url: "https://www.rfi.fr/fr/rss" }] },
  { id: "franceinfo", name: "franceinfo", lang: "fr", note: "Gratuit · service public",
    homepage: "https://www.francetvinfo.fr/", hosts: ["francetvinfo.fr", "www.francetvinfo.fr"],
    feeds: [{ name: "Les titres", url: "https://www.francetvinfo.fr/titres.rss" }] },
  { id: "20minutes", name: "20 Minutes", lang: "fr", note: "Gratuit · actualité courte",
    homepage: "https://www.20minutes.fr/", hosts: ["20minutes.fr", "www.20minutes.fr"],
    feeds: [{ name: "À la une", url: "https://www.20minutes.fr/feeds/rss-une.xml" }] },
  { id: "liberation", name: "Libération", lang: "fr", note: "Gratuit en partie",
    homepage: "https://www.liberation.fr/", hosts: ["liberation.fr", "www.liberation.fr"],
    feeds: [{ name: "Tous les articles", url: "https://www.liberation.fr/arc/outboundfeeds/rss-all/" }] },
  // ---- العربية
  { id: "aljazeera-ar", name: "الجزيرة", lang: "ar", note: "مجاني · أخبار",
    homepage: "https://www.aljazeera.net/", hosts: ["aljazeera.net", "www.aljazeera.net"],
    feeds: [{ name: "الأخبار", url: "https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9" }] },
  { id: "france24-ar", name: "فرانس 24", lang: "ar", note: "مجاني · دولي",
    homepage: "https://www.france24.com/ar/", hosts: ["france24.com", "www.france24.com"],
    feeds: [{ name: "الأخبار", url: "https://www.france24.com/ar/rss" }] },
  { id: "bbc-ar", name: "بي بي سي عربي", lang: "ar", note: "مجاني · دولي",
    homepage: "https://www.bbc.com/arabic", hosts: ["bbc.com", "www.bbc.com"],
    feeds: [{ name: "الأخبار", url: "https://feeds.bbci.co.uk/arabic/rss.xml" }] },
];
