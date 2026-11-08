import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "../electron/feeds";

test("parses RSS 2.0 with media:content images", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Le Monde.fr</title>
    <item>
      <title><![CDATA[En Algérie, la mémoire de l'indépendance]]></title>
      <link>https://www.lemonde.fr/afrique/article/2026/11/06/exemple_123.html</link>
      <description><![CDATA[<p>Un <b>récit</b> &nbsp;détaillé.</p>]]></description>
      <pubDate>Fri, 06 Nov 2026 10:00:00 +0100</pubDate>
      <media:content url="https://img.lemde.fr/x.jpg" width="644" height="322"/>
    </item>
  </channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(item.title, "En Algérie, la mémoire de l'indépendance");
  assert.equal(item.link, "https://www.lemonde.fr/afrique/article/2026/11/06/exemple_123.html");
  assert.equal(item.description, "Un récit détaillé.");
  assert.equal(item.imageUrl, "https://img.lemde.fr/x.jpg");
});

test("parses Atom entries", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Vu de l'étranger</title><link rel="alternate" href="https://www.courrierinternational.com/article/x"/>
    <updated>2026-11-06T09:00:00Z</updated><summary>Résumé</summary></entry>
  </feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, "https://www.courrierinternational.com/article/x");
});
