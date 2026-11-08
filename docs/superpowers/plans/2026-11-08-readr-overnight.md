# Readr overnight work (until 11:00) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish turning Readr into one French-study app for articles and YouTube videos: verified logged-in Le Monde, Magpie TTS read-aloud, language drawers, Anki cards with screenshot and audio, and video polish.

**Architecture:** Electron main process (`electron/`), React renderer (`src/`), shared pure code (`shared/`), Python FastAPI sidecar (`sidecar/server.py`, port 8765). Videos are stored as `Article`s with `kind: "video"` and per-sentence `cues`, and are played in a `WebContentsView` (`electron/video.ts` + `electron/video-preload.ts`). This was built and verified tonight.

**Tech Stack:** Electron 45.2.3, React 19.3.1, TypeScript 7.0.2, Vite 8.3.6, Node 24; Python 3.12 sidecar with ctranslate2, spaCy, FastAPI; yt-dlp and ffmpeg in `/opt/homebrew/bin`.

**Spec:** the user's decisions in this session, recorded in memory `readr-language-app.md`:
- articles and videos in one app, matching Readr's design;
- Magpie TTS replaces the macOS voice, with no fallback;
- per-language drawers;
- Vivaldi login import that is one-time and self-refreshing;
- never spoof user agents.

## Global Constraints

- Use the latest package versions, looked up live (`npm view`, PyPI); never from memory.
- No Google sign-in workarounds or user-agent spoofing.
- Don't open visible windows on the user's screen. E2E harnesses run with `READR_HIDDEN=1`, or with opacity 0 and `showInactive()`.
- Never leave exported browser cookies on disk. Delete temporary jars immediately.
- The macOS system voice (`speechSynthesis`) is removed entirely once Magpie works.
- All design uses the tokens in `src/lib/theme.ts`.
- Commit locally only; never push.

## Review Focus

1. **The sidecar isn't running yet when Listen is pressed.** The player should show "Voice is loading…", not fail silently. Test in Task 3 (`/speak` returns 503 while loading, and the UI shows the message).
2. **A sentence with numbers or abbreviations ("600000", "M.", "%").** Magpie's text normaliser should read it properly. Test in Task 3 (a French sample with "85 %" and "M. Lecornu" synthesises non-empty audio).
3. **The Anki profile folder is missing, or there are several profiles.** Export should still write the `.txt` file and say where the media went. Test in Task 5 (`copyMediaToAnki` with no profile returns `null` without throwing).
4. **A video with a pre-roll ad.** The counter shows "Publicité…", the transcript doesn't jump, and capture waits. Covered by the `ad` flag in `VideoState`; checked manually in Task 6.
5. **Opening a second video while the first plays.** The view switches and the old overlay text clears. Test in Task 6 (the harness opens two videos in a row and asserts the counter resets to `1 / N`).

---

### Task 1: Put Readr under its own git repo

**Files:**
- Create: `readr/.git` (via `git init`)
- Modify: `readr/.gitignore` (add `out/`)

- [ ] **Step 1:** `cd readr && git init && git add -A && git status --short | head`. Expected: no `node_modules`, `dist*`, `sidecar/.venv`, `sidecar/models` or `.zip` files.
- [ ] **Step 2:** Commit `chore: import Readr; Mac fixes, deps upgrade, video mode, browser-login import`.

### Task 2: Verify logged-in Le Monde with the real imported login

**Files:**
- Test: `tests/e2e/login-check.js` (new; read-only use of a temporary copy of Readr's session)

- [ ] **Step 1:** Write `login-check.js`. It copies `~/Library/Application Support/readr/Partitions/readr` into a temporary userData, runs `extractArticle(url, session.fromPartition("persist:readr"))` on today's first Le Monde *À la une* article, prints `{paywalled, words}`, and deletes the copy in `finally`.
- [ ] **Step 2:** Run it. Expected: `paywalled: false`, `words > 600`. If it comes back paywalled, check whether `browser-login.json` exists. If it doesn't, the user hasn't clicked the button yet: note it in FINDINGS and move on. Don't import cookies without the user present.
- [ ] **Step 3:** Commit any extraction fix together with its test.

### Task 3: Magpie TTS replaces the system voice

**Files:**
- Create: `sidecar/tts.py` (Magpie loading and synthesis)
- Modify: `sidecar/server.py` (`POST /speak`, `GET /voices`), `sidecar/requirements.txt`
- Modify: `src/lib/speech.ts` (rewrite `useSentenceReader` and `useVoices` around sidecar audio), `src/components/audio-player.tsx`, `src/components/dictionary-popup.tsx` and `vocabulary-view.tsx` (pronounce buttons)
- Test: `sidecar/test_sidecar.py`

**Interfaces:**
- Produces: `POST /speak {text: str, lang: "fr"|"en"|"ar", voice: str} -> audio/wav`. `503` while loading, `400` on empty text. `GET /voices -> {voices: string[], ready: bool}`.
- Renderer: `useVoices(): {voices: string[], ready: boolean}`, plus `useSentenceReader({sentences, lang, rate, voice, onFinished})`, keeping today's return shape `{playing, index, play, pause, prev, next, jumpTo}`.

- [ ] **Step 1: Pick the runtime.** First try NeMo-Speech.cpp (`nemo-speech pull magpie`, then `nemo-speech synthesize "Bonjour à tous." --language-code fr-FR`). Fall back to the NeMo Python framework (latest `nemo_toolkit[tts]` and `torch`, on MPS). Record the real-time factor for a 15-word French sentence. Pass: under 1.0 (faster than real time).
- [ ] **Step 2: Write failing tests** in `test_sidecar.py`, using a stub synthesiser like the existing translator stub:
  - `test_speak_returns_wav`: response is 200, `content-type` is `audio/wav`, body starts with `b"RIFF"`.
  - `test_speak_rejects_empty`: 400.
  - `test_speak_503_while_loading`.
  - `test_voices_lists_magpie_speakers`: includes `"Sofia"`.
- [ ] **Step 3:** Implement `tts.py`, with `class MagpieTTS: load() -> None; speak(text: str, lang: str, voice: str) -> bytes` (WAV). Load in the sidecar's background thread after the translator. Cache the last 200 `(text, voice)` results in memory.
- [ ] **Step 4:** Run `pytest`. Then a real smoke test: `/speak` with "Selon un sondage, 85 % des sondés estiment que M. Lecornu…" returns more than 1 s of audio.
- [ ] **Step 5:** Rewrite `speech.ts`. Each sentence is fetched as a blob through a new main-process IPC `speak(text, lang, voice) -> ArrayBuffer`; the renderer can't reach `127.0.0.1` because of its CSP. The next sentence is prefetched while the current one plays. Playback rate is set with `audio.playbackRate`. Delete every `speechSynthesis` use (`grep -r speechSynthesis src` comes back empty). The voice picker lists `/voices`.
- [ ] **Step 6:** E2E: extend `tests/e2e/harness.js` with a stub `/speak` returning a short WAV and `/voices`. Click Listen, assert the player shows sentence 1, then sentence 2 after it ends.
- [ ] **Step 7:** Commit `feat: Magpie TTS read-aloud replaces system voice`.

### Task 4: Language drawers in the sidebar

**Files:**
- Modify: `shared/types.ts` (`Feed.lang: Lang`, `Site.lang: Lang`), `electron/sites.ts` (set `lang: "fr"`; add the Le Figaro feed `https://www.lefigaro.fr/rss/figaro_actualites.xml`, source "Le Figaro", name "Actualités"), `src/components/left-sidebar.tsx`, `src/lib/settings.ts` (`openDrawers: Lang[]`, default `["fr"]`)
- Test: `tests/e2e/harness.js`

**Interfaces:**
- Produces: sidebar section ids `feed:<id>` (unchanged) and new `videos:<lang>`, which lists library items with `kind === "video"` in that language.

- [ ] **Step 1:** Add an e2e assertion that the sidebar contains a "Français" drawer header and, inside it, "Le Monde", "Le Figaro", "Courrier International" and "Vidéos". Run it and see it fail.
- [ ] **Step 2:** Implement the drawers. Each drawer header shows the language name in that language ("Français", "العربية", "English"), a chevron, and a count of unread saved items. Opening and closing persists through settings. Inside: the sources' feeds, then "Vidéos". Only languages that have a feed or saved item get a drawer. Keep the existing `GroupLabel` and `navButton` styling.
- [ ] **Step 3:** E2E passes. Read the screenshot and check it against Readr's style: no new colours or fonts.
- [ ] **Step 4:** Commit `feat: per-language drawers; Le Figaro feed; Videos list`.

### Task 4b: "Add source": any news site, in its language drawer

**Files:**
- Create: `electron/sources.ts`
- Modify:
  - `electron/sites.ts`: the built-ins become defaults.
  - `electron/store.ts`: user sources in `sources.json`.
  - `electron/feeds.ts`: a homepage-links fallback.
  - `electron/main.ts`: IPC `addSource(url)`, `removeSource(id)`; `sites` and `feeds` return built-ins plus user sources.
  - `src/components/left-sidebar.tsx`: an "Add source" row in each drawer, with a language picker.
- Test: `tests/sources.test.ts`, plus an e2e step against a local fixture site.

**Interfaces:**
- Produces:
  - `discoverSource(url: string, session: Session): Promise<{site: Site; feed: Feed; lang: Lang}>`. A hidden window in the logged-in session loads the homepage and reads `og:site_name`, `<html lang>`, `link[rel=alternate][type*=rss|atom]` and the favicon.
  - `homepageItems(html: string, base: string): FeedItem[]`: same-host links whose path looks like an article (at least 3 path segments, or a numeric id, or a date), deduplicated, first 40. Used when there's no feed.
- Login: `importBrowserLogins` and the paywall auto-refresh use `SITES ∪ user sources` hosts, so an added site's existing Vivaldi login works with no extra step.

- [ ] **Step 1: Failing tests:**
  - `homepageItems` on fixture HTML picks the article links and skips nav, tag and author links;
  - an RSS `<link>` is preferred when present;
  - a user source is persisted and listed by `sites()`;
  - its hosts are included in the import host list.
- [ ] **Step 2:** Implement. The language is preselected from `<html lang>` but can be changed in the add dialog, since lorientlejour.com reports `en-US`.
- [ ] **Step 3:** Real check on `https://www.lorientlejour.com`. It returns 403 to curl, so discovery must go through the Electron session. Pass: a list of today's articles appears; one article extracts; with the Vivaldi login imported, it isn't paywalled.
- [ ] **Step 4:** Commit `feat: add any news source to a language drawer`.

### Task 4c: Home front page and a free-source catalogue

**Files:**
- Create:
  - `electron/catalog.ts`: built-in list of free sources (no login).
  - `src/components/home-view.tsx`: the front page.
- Modify:
  - `src/App.tsx`: new section `home`, the default on launch, replacing today's empty state.
  - `src/components/left-sidebar.tsx`: "Accueil" nav item at the top.
  - `electron/main.ts`: IPC `catalog()` and `addCatalogSource(id)`.
- Test: `tests/e2e/harness.js` (the home renders cards from the fixture feed).

**Catalogue.** Each entry is `{id, name, lang, homepage, feeds: {name, url}[], kind: "news" | "video"}`. The feed URLs below were checked live on 2026-11-08 (HTTP 200, with items):
- **ar:**
  - Al Jazeera (`https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9`)
  - France 24 عربي (`https://www.france24.com/ar/rss`)
  - BBC عربي (`https://feeds.bbci.co.uk/arabic/rss.xml`)
- **fr:**
  - France 24 (`https://www.france24.com/fr/rss`)
  - RFI (`https://www.rfi.fr/fr/rss`)
  - franceinfo (`https://www.francetvinfo.fr/titres.rss`)
  - 20 Minutes (`https://www.20minutes.fr/feeds/rss-une.xml`)
  - Libération (`https://www.liberation.fr/arc/outboundfeeds/rss-all/`)
- **Video (YouTube channel feeds, `https://www.youtube.com/feeds/videos.xml?channel_id=…`):** France 24 French and Al Jazeera Arabic. Look up the channel ids with `yt-dlp --print channel_id` on one video of each. Their items open in Readr's video mode.

**Interfaces:**
- Produces: `CatalogSource` (above) and `catalog(): CatalogSource[]`, with `added: boolean` per entry. `addCatalogSource(id)` reuses Task 4b's user-source store, so added sources behave exactly like ones added by URL, including drawers and login import.

**Home layout (Readr tokens only):**
- A top "newsbar": a horizontal strip of the latest headlines across all your sources, with source name and time. It scrolls with the trackpad and has no auto-ticker.
- One section per language drawer, as a grid of cards: image, headline, source and time. The first card in each section is a larger hero.
- A "Vidéos" row of thumbnails from the video sources.
- At the bottom, "Ajouter des sources": catalogue cards grouped by language, each with a name, a short note ("Gratuit") and an Add/Added toggle.
- Headlines in RTL languages render right-to-left with `ARABIC_FONT`.

- [ ] **Step 1:** Add an e2e assertion that on launch the page shows "Accueil", the fixture feed's headline, and a catalogue card with an "Ajouter" button. Run it and see it fail.
- [ ] **Step 2:** Implement. Feeds are fetched in parallel through the existing `fetchFeed` (session-backed), and the newest items are merged by date. Opening a card uses `openUrl`: articles go to the reader, and YouTube links go to video mode.
- [ ] **Step 3:** The e2e passes. Run a real check in a hidden window: add France 24 and Al Jazeera from the catalogue, take a screenshot of the home page, and read it to check the Arabic is RTL and the cards have images.
- [ ] **Step 4:** Commit `feat: home front page and free-source catalogue`.

### Task 5: Anki cards carry the screenshot and audio

**Files:**
- Modify: `electron/store.ts` (`vocabToTsv`), `electron/main.ts` (`exportVocab`)
- Create: `electron/anki.ts`
- Test: `tests/anki.test.ts`

**Interfaces:**
- Produces:
  - `ankiMediaDirs(home: string): string[]`: every `~/Library/Application Support/Anki2/*/collection.media`.
  - `copyMediaToAnki(files: string[], fromDir: string, home: string): string | null`: returns the destination, or `null` when none exists.
  - `toMp3(webm: string): Promise<string>`: ffmpeg, `-c:a libmp3lame -q:a 4`; AnkiMobile can't play webm.

- [ ] **Step 1: Failing tests:**
  - `vocabToTsv` puts `<img src="X.jpg">` and `[sound:X.mp3]` on the Back field when an entry has `image` and `audio`;
  - entries without media are unchanged;
  - `copyMediaToAnki` with a temporary home containing no Anki folder returns `null`.
- [ ] **Step 2:** Implement. `videoCapture` converts to mp3 right after recording, stores the `.mp3` name and deletes the `.webm`. Export copies media to every profile folder found, and the save dialog's success message names the folder.
- [ ] **Step 3:** `npm test` passes. Then a manual run: the video harness saves a word, and the exported TSV references existing files.
- [ ] **Step 4:** Commit `feat: Anki export with line screenshot and audio`.

### Task 6: Video polish

**Files:**
- Modify: `src/App.tsx`, `src/components/video-stage.tsx`, `src/components/reader-view.tsx`, `src/lib/settings.ts`, `electron/video-preload.ts`
- Test: `tests/e2e/video-ui-harness.js`

- [ ] **Step 1: Failing harness assertions:**
  - (a) opening the same video again resumes near the saved position (±3 s);
  - (b) opening a second video (`https://www.youtube.com/watch?v=` plus any other French video with auto-captions, found with `yt-dlp ytsearch1:"France 24 français"`) resets the counter to `1 / N`;
  - (c) a plain click on the gap before a sentence (a new hover "▸" marker in the left margin) seeks to it.
- [ ] **Step 2:** Implement:
  - Store the last position as `Article.progress`, in seconds for videos, and seek to it on open.
  - Clear the overlay when the video changes.
  - Add the margin play marker (`tokens.secondary`, visible on sentence hover).
  - Persist `videoOverlay` in settings.
  - Hide the reader's title header for videos, since the title is in the sidebar card, so the transcript starts higher.
- [ ] **Step 3:** The harness passes. Read both screenshots, light and dark.
- [ ] **Step 4:** Commit `feat: video resume, sentence play marker, overlay setting`.

### Task 7: Review, docs and morning summary

**Files:**
- Modify: `README.md` (Mac setup; videos; browser login; Magpie)
- Create: `FINDINGS-video.md`

- [ ] **Step 1:** Run `npm run typecheck && npm test && (cd sidecar && .venv/bin/python -m pytest -q)` and both e2e harnesses. Everything passes.
- [ ] **Step 2:** Run a whole-branch review on `git diff <task-1 commit>..HEAD` with the code-review skill, and fix any confirmed findings.
- [ ] **Step 3:** Write `FINDINGS-video.md`: what works, with the screenshot paths; what needs the user (clicking "Use my Vivaldi login", the Keychain prompt); known limits (signed-out YouTube means ads; no Premium); next ideas. Then relaunch Readr for the user.
- [ ] **Step 4:** Commit `docs: README and overnight findings`.
