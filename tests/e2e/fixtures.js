// A Le Monde-shaped test article (original text written for the tests) plus
// a paywalled variant, served from a local HTTP server during the smoke test.

const paragraphs = [
  "À Alger, les archives de la presse coloniale racontent une histoire que les manuels scolaires ont longtemps simplifiée. M. Benali, conservateur à la Bibliothèque nationale, consacre ses journées à les numériser.",
  "Les journaux de l'époque mêlaient le français et l'arabe. Certains titres paraissaient même dans les deux langues, page après page, pour toucher des lecteurs très différents.",
  "Aujourd'hui, une équipe de chercheurs utilise l'intelligence artificielle pour transcrire ces pages abîmées. Le travail avance lentement, mais les premiers résultats sont encourageants.",
  "« Chaque numéro est un témoignage », explique la directrice du projet. Elle espère ouvrir la collection au public avant la fin de l'année.",
];

const translations = {
  "Les archives oubliées de la presse algérienne": "The forgotten archives of the Algerian press",
  [paragraphs[0].split(". M.")[0] + "."]: "In Algiers, the archives of the colonial press tell a story that school textbooks long simplified.",
  "M. Benali, conservateur à la Bibliothèque nationale, consacre ses journées à les numériser.": "Mr. Benali, a curator at the National Library, spends his days digitizing them.",
  "Les journaux de l'époque mêlaient le français et l'arabe.": "The newspapers of the time mixed French and Arabic.",
  "Certains titres paraissaient même dans les deux langues, page après page, pour toucher des lecteurs très différents.": "Some titles even appeared in both languages, page after page, to reach very different readers.",
  "Aujourd'hui, une équipe de chercheurs utilise l'intelligence artificielle pour transcrire ces pages abîmées.": "Today, a team of researchers is using artificial intelligence to transcribe these damaged pages.",
  "Le travail avance lentement, mais les premiers résultats sont encourageants.": "The work is moving slowly, but the first results are encouraging.",
  "« Chaque numéro est un témoignage », explique la directrice du projet.": "“Every issue is a testimony,” explains the project's director.",
  "Elle espère ouvrir la collection au public avant la fin de l'année.": "She hopes to open the collection to the public before the end of the year.",
};

function page({ paywalled }) {
  const body = paywalled ? paragraphs.slice(0, 1) : paragraphs;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Les archives oubliées de la presse algérienne</title>
<meta property="og:title" content="Les archives oubliées de la presse algérienne">
<meta property="og:description" content="Des chercheurs numérisent des milliers de pages publiées pendant la période coloniale.">
<meta property="og:site_name" content="Le Monde.fr">
<meta property="article:published_time" content="2026-11-06T08:30:00+01:00">
<meta name="author" content="Claire Dumas">
</head><body>
<header><nav>Menu · Rubriques · S'abonner</nav></header>
<main><article class="article">
  <h1>Les archives oubliées de la presse algérienne</h1>
  <section class="article__content">
    ${body.map((p) => `<p class="article__paragraph">${p}</p>`).join("\n")}
    <p>Lire aussi | Un autre article sans rapport</p>
    ${paywalled ? '<div class="article__status">Il vous reste 80% de cet article à lire. La suite est réservée aux abonnés.</div>' : ""}
  </section>
</article>
<aside><h3>Les plus lus</h3><ul><li>Autre chose</li></ul></aside></main>
<footer>© Le Monde</footer>
</body></html>`;
}

module.exports = { page, translations, paragraphs };
