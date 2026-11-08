// Drives the real Readr UI (hidden window) with a YouTube video: adds it by
// link, waits for playback, checks the transcript follows the video, steps
// sentences, and writes screenshots with the player composited in.
//
//   npm run build && READR_HIDDEN=1 npx electron tests/e2e/video-ui-harness.js <outDir> [videoUrl]

const { app, BrowserWindow, webContents } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2).filter((a) => !a.endsWith(".js") && a !== ".");
const outDir = path.resolve(args[0] ?? path.join(os.tmpdir(), "readr-video-ui"));
const videoUrl = args[1] ?? "https://www.youtube.com/watch?v=Vpj_DUiw650";
fs.mkdirSync(outDir, { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "readr-video-ui-")));
process.env.READR_HIDDEN = "1";
app.dock?.hide();

const results = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (win, code) => win.webContents.executeJavaScript(code, true);

async function waitFor(win, predicate, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await js(win, `Boolean(${predicate})`)) return true;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Readr's page plus the native player view drawn where it sits. */
async function shot(win, name) {
  const page = (await win.webContents.capturePage()).toDataURL();
  const player = webContents.getAllWebContents().find((w) => w.getURL().includes("youtube.com/watch"));
  const view = win.contentView.children[0];
  let video = null;
  if (player && view && view.getVisible?.() !== false) {
    const b = view.getBounds();
    video = { url: (await player.capturePage()).toDataURL(), ...b };
  }
  const data = await js(win, `(async () => {
    const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const base = await load(${JSON.stringify(page)});
    const c = document.createElement("canvas"); c.width = base.width; c.height = base.height;
    const g = c.getContext("2d"); g.drawImage(base, 0, 0);
    const v = ${JSON.stringify(video)};
    if (v) { const s = base.width / window.innerWidth; const im = await load(v.url);
      g.save(); g.beginPath(); g.roundRect(v.x * s, v.y * s, v.width * s, v.height * s, 8 * s); g.clip();
      g.drawImage(im, v.x * s, v.y * s, v.width * s, v.height * s); g.restore(); }
    return c.toDataURL("image/png");
  })()`);
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data.split(",")[1], "base64"));
}

async function run() {
  require("../../dist-electron/electron/main.js");
  await app.whenReady();
  let win;
  while (!(win = BrowserWindow.getAllWindows()[0])) await sleep(100);
  // Rendered but invisible and click-through, so screenshots work without a
  // window appearing on screen.
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
  await sleep(500);

  await js(win, `(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add article").click();
    return new Promise((r) => setTimeout(() => {
      const input = document.querySelector("input[placeholder^='Paste']");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(videoUrl)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.form.requestSubmit();
      r(true);
    }, 100));
  })()`);
  await waitFor(win, `document.querySelector("h1") && document.querySelectorAll(".readr-sentence").length > 10`, "video transcript", 90000);
  results.sentences = await js(win, `document.querySelectorAll(".readr-sentence").length`);
  results.title = await js(win, `document.querySelector("h1").textContent`);

  // Playback moves the highlighted sentence.
  await waitFor(win, `parseInt(document.querySelector("[data-video-counter]")?.textContent ?? "0") >= 2`, "playback past the first sentence", 90000).catch((e) => (results.playbackError = e.message));
  results.counter = await js(win, `document.querySelector("[data-video-counter]")?.textContent ?? ""`);
  results.activeSentence = await js(win, `[...document.querySelectorAll(".readr-sentence")].find((s) => s.style.background && s.style.background !== "")?.textContent ?? null`);
  await sleep(2500); // let translations arrive
  await shot(win, "1-video-interlinear");

  // Next sentence (D) moves the counter forward.
  const before = results.counter;
  await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }))`);
  await sleep(1500);
  results.afterNext = await js(win, `document.querySelector("[data-video-counter]")?.textContent ?? ""`);
  results.nextMoved = results.afterNext !== before;

  // Bilingual + dark.
  await js(win, `window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" }))`);
  await js(win, `document.querySelector("button[title='Dark mode']").click()`);
  await sleep(1200);
  await shot(win, "2-video-bilingual-dark");
}

run()
  .catch((e) => (results.error = String(e && e.message ? e.message : e)))
  .finally(() => {
    console.log("VIDEO_UI_RESULTS " + JSON.stringify(results));
    app.quit();
  });
