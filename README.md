# Readr

A calm desktop reader for **Le Monde** and **Courrier International**, built for learning French. It uses your own subscription logins, strips each article down to clean text, and gives you sentence-by-sentence translation and click-any-word lookup. Everything runs locally and costs nothing per article.

The UI is a port of the *Slick Article Reader* Figma Make design.

## How it works

- **Your login, reused.** Readr runs on Electron, which is Chromium. You sign in once in a normal site window, and the cookies are kept in a persistent session (`persist:readr`). Readr never sees or stores your password.
- **Article extraction.** A hidden window in that same session loads the article as you. Mozilla Readability then pulls out the text, drops site chrome and "Lire aussi" links, and splits the text into sentences. If the page only shows the paywall preview, Readr tells you and offers to open the sign-in window.
- **Feeds.** The sidebar lists Le Monde *À la une* and *International*, plus Courrier International. Courrier's RSS address is discovered from its homepage rather than hard-coded.
- **Translation and lookup.** These come from a small Python server (`sidecar/`) that Electron starts for you:
  - **quickmt-fr-en** (200M parameters, CTranslate2) translates sentences. It downloads automatically on first run, about 200 MB.
  - **spaCy `fr_core_news_sm`** gives each word's lemma, part of speech, gender, number, tense and mood.
  - An **offline Wiktionary dictionary** (optional, built once) gives real English definitions and IPA.
- **Library.** Articles, translations, reading progress and saved words are stored as JSON in Electron's user-data folder.

## Setup

You need Node 20+ and Python 3.10+. These commands are for Windows PowerShell; on macOS or Linux, use `.venv/bin/...` instead.

```powershell
npm install

cd sidecar
uv venv                                   # or: python -m venv .venv
uv pip install -r requirements.txt        # or: .venv\Scripts\pip install -r requirements.txt
cd ..

npm run dev
```

Readr finds `sidecar/.venv` on its own. To use a different interpreter, set `READR_PYTHON`.

### Optional: the full dictionary

Without the dictionary, the word popup still shows grammar plus a machine gloss. To get full Wiktionary entries:

1. Download the French data from kaikki.org. The French-only file is about 565 MB (kaikki marks it as deprecated, but it is still served): `https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl`. If that file is gone, use the full dump instead: `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz` (about 2.9 GB; only French entries are kept).
2. Build the dictionary:

```powershell
cd sidecar
.venv\Scripts\python build_dict.py C:\path\to\kaikki.org-dictionary-French.jsonl
```

The script writes `sidecar/data/fr-en.sqlite`. Restart Readr to pick it up.

### Read-aloud voices

The **Listen** button uses your system's built-in speech voices, so it works offline. On Windows, go to *Settings → Time & language → Speech → Add voices → Français (France)*.

## Using it

1. In the right panel under **Subscriptions**, click **Le Monde**. Sign in, then close the window. Do the same for Courrier International.
2. Pick a story from the sidebar, or use **Add article** to paste any article link.

| | |
|---|---|
| `1` `2` `3` `4` | Original · Interlinear (translation under each sentence) · Bilingual (side by side) · Translation only |
| Click a word | Definition, grammar, pronunciation; the bookmark icon saves it to **Vocabulary** |
| Alt + click a sentence | Read aloud from that sentence |
| `f` | Distraction-free: hides both side panels |
| *Hide until hover* | Blurs translations so you test yourself first |
| Vocabulary → **Export for Anki** | Tab-separated file; Anki → *File → Import* |

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `READR_DEVICE` | `auto` | `cpu` or `cuda` for quickmt |
| `READR_BEAM` | `4` | Beam size; `1` is fastest |
| `READR_TRANSLATOR` | (auto) | Set to `opus` to use Helsinki-NLP/opus-mt-fr-en instead; needs `pip install transformers sentencepiece torch` |
| `READR_PYTHON` | `sidecar/.venv` | Python used to start the sidecar |
| `READR_NO_SIDECAR` | | Don't start the sidecar; useful if you run `python sidecar/server.py` yourself |

To try a bigger model later, such as Hy-MT2-1.8B, add a `_load_*` method to `Engines` in `sidecar/server.py`. The rest of the app only sees `/translate`.

## Tests

```powershell
npm test                                          # sentence splitting, tokenizer, RSS parsing
cd sidecar; .venv\Scripts\python -m pytest        # API + dictionary builder (stub translator, no download)
npm run test:e2e                                  # drives the real app against a local test article
```

On Linux without a display, run the end-to-end test as `xvfb-run -a npx electron --no-sandbox tests/e2e/harness.js out/`. It writes screenshots to `out/`.

## Layout

```
electron/   main process: session, login windows, extraction, feeds, storage, sidecar launcher
shared/     types and the French sentence splitter / tokenizer (used by both sides)
src/        React UI ported from the Figma design
sidecar/    FastAPI server: quickmt translation, spaCy analysis, Wiktionary lookup
tests/      unit tests and the Electron end-to-end harness
```

## A note on use

This is for reading articles you already pay for, on your own machine. Don't add features that redistribute article text.
