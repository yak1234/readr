// End-to-end check of the YouTube player against the real site (needs network
// and yt-dlp). It adds a video, plays it in the embedded player, checks that
// playback is reported, seeks, records a line's screenshot and audio clip, and
// saves a window screenshot.
//
//   npm run build && npx electron tests/e2e/video-harness.js <outDir> [videoUrl]

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2).filter((a) => !a.endsWith(".js") && a !== ".");
const outDir = path.resolve(args[0] ?? path.join(os.tmpdir(), "readr-video-e2e"));
const videoUrl = args[1] ?? "https://www.youtube.com/watch?v=Vpj_DUiw650";
fs.mkdirSync(outDir, { recursive: true });
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "readr-video-e2e-")));

const dist = path.join(__dirname, "..", "..", "dist-electron", "electron");
const { extractVideo, registerVideoIpc } = require(path.join(dist, "video.js"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};

app.whenReady().then(async () => {
  const ses = session.fromPartition("persist:readr-video-e2e");
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: { preload: path.join(dist, "preload.js"), contextIsolation: true, sandbox: true },
  });
  registerVideoIpc(() => win, () => ses);
  win.setOpacity(0);
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  app.dock?.hide();
  await win.loadURL("data:text/html,<body style='margin:0;background:%23eee'><h3 style='margin:560px 20px'>Readr video harness</h3></body>");
  const js = (code) => win.webContents.executeJavaScript(code, true);
  await js(`window.states = []; window.readr.onVideoState((s) => window.states.push(s)); 0`);

  try {
    const t0 = Date.now();
    const r = await extractVideo(videoUrl, ses);
    results.extractMs = Date.now() - t0;
    results.extractOk = r.ok;
    if (!r.ok) throw new Error(r.error);
    const a = r.article;
    results.title = a.title;
    results.sentences = a.blocks.reduce((n, b) => n + b.sentences.length, 0);
    results.firstSentence = a.blocks[0].sentences[0];

    await js(`window.readr.videoShow(${JSON.stringify(a.videoId)}, { x: 0, y: 0, width: 1280, height: 540 })`);
    // Wait for the player to report time moving (an ad may play first).
    let moving = false;
    for (let i = 0; i < 60 && !moving; i++) {
      await sleep(1000);
      const s = await js(`window.states.slice(-1)[0] || null`);
      results.lastState = s;
      if (s && !s.paused && !s.ad && s.time > 1) moving = true;
      if (s && s.paused && i === 8) await js(`window.readr.videoToggle()`); // autoplay may be blocked
    }
    results.playing = moving;
    results.sawAd = await js(`window.states.some((s) => s.ad)`);

    // Seek to the third sentence and check the reported time follows.
    const [start, end] = a.cues[0][2];
    await js(`window.readr.videoSeek(${start}, true)`);
    await sleep(1500);
    const afterSeek = await js(`window.states.slice(-1)[0]`);
    results.seekTarget = start;
    results.seekLanded = afterSeek && Math.abs(afterSeek.time - start) < 2.5;

    await js(`window.readr.videoOverlay(${JSON.stringify(a.blocks[0].sentences[2])}, "(translation goes here)")`);
    await sleep(500);
    const { webContents } = require("electron");
    const player = webContents.getAllWebContents().find((w) => w.getURL().includes("youtube.com/watch"));
    results.layout = await player.executeJavaScript(`(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
      const ov = document.getElementById("readr-overlay");
      return { viewport: [innerWidth, innerHeight], player: r(document.getElementById("movie_player")), video: r(document.querySelector("video.html5-main-video")),
        overlay: r(ov), overlayText: ov && ov.innerText, overlayDisplay: ov && getComputedStyle(ov).display, css: !!document.getElementById("readr-css"),
        playerParentTransform: (() => { let e = document.getElementById("movie_player"); const out = []; while (e) { const cs = getComputedStyle(e); if (cs.transform !== "none" || cs.contain !== "none" || cs.filter !== "none") out.push(e.tagName + "#" + e.id + " " + cs.transform + " " + cs.contain); e = e.parentElement; } return out; })() };
    })()`);
    fs.writeFileSync(path.join(outDir, "player.png"), (await player.capturePage()).toPNG());
    fs.writeFileSync(path.join(outDir, "window.png"), (await win.webContents.capturePage()).toPNG());

    const media = await js(`window.readr.videoCapture(${start}, ${end})`);
    results.capture = media;
    if (media) {
      const dir = path.join(app.getPath("userData"), "library", "media");
      for (const f of [media.image, media.audio].filter(Boolean)) {
        fs.copyFileSync(path.join(dir, f), path.join(outDir, f));
        results[`${path.extname(f).slice(1)}Bytes`] = fs.statSync(path.join(dir, f)).size;
      }
    }
    results.lineSeconds = Math.round((end - start) * 100) / 100;
  } catch (err) {
    results.error = String(err && err.message ? err.message : err);
  }
  console.log("VIDEO_RESULTS " + JSON.stringify(results));
  app.quit();
});
