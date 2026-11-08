// End-to-end smoke test: runs the real Electron app against a local article
// server and a stub translation server, drives the UI, and takes screenshots.
//
//   npm run build && xvfb-run -a npx electron --no-sandbox tests/e2e/harness.js <outDir>

const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { page, translations } = require("./fixtures");

const outDir = path.resolve(process.argv[process.argv.length - 1].endsWith(".js") ? os.tmpdir() : process.argv[process.argv.length - 1]);
fs.mkdirSync(outDir, { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "readr-e2e-")));
process.env.READR_NO_SIDECAR = "1";

const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(port, handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function startServers() {
  const site = await serve(0, (req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(page({ paywalled: req.url.includes("paywall") }));
  });
  const json = (res, body) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((r) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => r(JSON.parse(d || "{}")));
  });
  await serve(8765, async (req, res) => {
    if (req.url === "/health") return json(res, { ok: true, translator: "stub", spacy: true, dictionary: true, message: "Ready" });
    const body = await readBody(req);
    if (req.url === "/translate") return json(res, { translations: body.sentences.map((s) => translations[s] ?? `[EN] ${s}`) });
    if (req.url === "/lookup")
      return json(res, {
        word: body.word, lemma: "archive", pos: "NOUN", morph: { Gender: "Fem", Number: "Plur" }, ipa: "/aʁ.ʃiv/",
        senses: [{ pos: "noun", glosses: ["archive, record", "archives (place)"], tags: ["feminine"] }],
        mtGloss: "archives", dictionaryAvailable: true,
      });
    res.statusCode = 404;
    res.end();
  });
  return `http://127.0.0.1:${site.address().port}`;
}

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function waitFor(win, predicate, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(win, `Boolean(${predicate})`)) return true;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
}

const openUrlViaUi = (url) => `(() => {
  const add = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add article");
  add.click();
  return new Promise((r) => setTimeout(() => {
    const input = document.querySelector("input[placeholder^='Paste']");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(url)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.form.requestSubmit();
    r(true);
  }, 100));
})()`;

async function run() {
  const base = await startServers();
  require("../../dist-electron/electron/main.js");
  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await sleep(100);
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
  await sleep(500);

  // 1. Paywalled page shows the sign-in notice.
  await js(win, openUrlViaUi(`${base}/paywall.html`));
  await waitFor(win, `document.body.innerText.includes("You don't seem to be signed in")`, "paywall notice");
  results.paywallNotice = true;
  await shot(win, "1-paywall");

  // 2. Full article: extraction, sentence split, "Lire aussi" removed.
  await js(win, openUrlViaUi(`${base}/article.html`));
  await waitFor(win, `document.querySelector("h1")?.textContent.includes("archives oubliées")`, "article title");
  results.sentences = await js(win, `document.querySelectorAll(".readr-sentence").length`);
  results.lireAussiRemoved = !(await js(win, `document.body.innerText.includes("Lire aussi")`));
  results.navRemoved = !(await js(win, `document.body.innerText.includes("Les plus lus")`));

  // 3. Interlinear translations arrive from the sidecar.
  await waitFor(win, `document.body.innerText.includes("The newspapers of the time mixed French and Arabic.")`, "interlinear translation");
  results.interlinear = true;
  await shot(win, "2-interlinear");

  // 4. Word popup.
  await js(win, `[...document.querySelectorAll(".readr-word")].find((w) => w.textContent === "archives").click()`);
  await waitFor(win, `document.querySelector("[role=dialog]")?.innerText.includes("archive, record")`, "dictionary popup");
  results.popup = true;
  await shot(win, "3-popup");
  await js(win, `document.querySelector("[role=dialog] button[title='Save to vocabulary']").click()`);
  await sleep(300);
  await js(win, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`);

  // 5. Bilingual and dark mode.
  await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }))`);
  await waitFor(win, `document.body.textContent.includes("Français") && document.body.textContent.includes("English")`, "bilingual headers");
  results.bilingual = true;
  await shot(win, "4-bilingual");
  await js(win, `document.querySelector("button[title='Dark mode']").click()`);
  await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "1" }))`);
  await sleep(400);
  await shot(win, "5-original-dark");

  // 6. Library + vocabulary persisted.
  results.vocabSaved = await js(win, `window.readr.vocab().then((v) => v.length)`);
  results.librarySaved = await js(win, `window.readr.library().then((l) => l.length)`);
  results.translationsPersisted = await js(win, `window.readr.library().then((l) => window.readr.getArticle(l[0].id)).then((a) => Object.keys(a.translations).length)`);
}

run()
  .then(() => {
    console.log("E2E_RESULTS " + JSON.stringify(results));
    app.exit(0);
  })
  .catch((err) => {
    console.log("E2E_FAILED " + err.message + " " + JSON.stringify(results));
    app.exit(1);
  });
