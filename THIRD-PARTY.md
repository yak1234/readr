# Third-party software and models in Readr

Readr's installer carries the programs and models below so that it works without anything else installed.
Each stays under its own licence. Versions are those of the build described by `runtime/MANIFEST.json`.

## Programs and libraries

| Name | Version | Licence | Source |
|---|---|---|---|
| Electron | 45.2.3 | MIT (bundles Chromium and Node.js under their own licences; see LICENSES.chromium.html inside the app) | https://github.com/electron/electron |
| CPython (python-build-standalone) | 3.12.13 | PSF License 2.0 | https://github.com/astral-sh/python-build-standalone |
| PyTorch | 2.15.0 | BSD-3-Clause | https://github.com/pytorch/pytorch |
| MLX, mlx-lm | 0.32.4, 0.32.2 | MIT | https://github.com/ml-explore/mlx |
| Stanza | 1.15.0 | Apache-2.0 (code) | https://github.com/stanfordnlp/stanza |
| FastAPI, Uvicorn, httpx | 0.162.2, 0.54.0, 0.28.1 | MIT, BSD-3-Clause, BSD-3-Clause | https://github.com/fastapi/fastapi |
| huggingface_hub, transformers | 2.4.0, 5.22.2 | Apache-2.0 | https://github.com/huggingface |
| pyradios (Radio Browser directory) | 2.1.1 | MIT | https://github.com/andreztz/pyradios |
| num2words | 0.5.14 | LGPL-2.1 | https://github.com/savoirfairelinux/num2words |
| yt-dlp | 2026.10.26 | Unlicense | https://github.com/yt-dlp/yt-dlp |
| FFmpeg (the build in the imageio-ffmpeg package) | 9.0 (imageio-ffmpeg 0.8.1) | GPL (built with `--enable-gpl`, no non-free parts). Readr runs it as a separate program. Source: https://ffmpeg.org/download.html; the package: https://github.com/imageio/imageio-ffmpeg | https://ffmpeg.org |
| NeMo-Speech.cpp | 0.3.0 | see the licence file in the app at Resources/runtime/speech/share | https://github.com/NVIDIA |

The bundled Python also carries the packages those libraries depend on (the full list, with versions, is in
`runtime/MANIFEST.json`), and the app carries its npm dependencies:

- @mozilla/readability (Apache-2.0)
- electron-context-menu (MIT)
- fast-xml-parser (MIT)
- kysely (MIT)
- p-queue (MIT)
- p-wait-for (MIT)
- tldts (MIT)
- ts-fsrs (MIT)

## Models

| Model | Where it comes from | Licence |
|---|---|---|
| Hy-MT2 1.8B (8-bit MLX conversion) | mlx-community/Hy-MT2-1.8B-8bit, from Tencent-Hunyuan/Hy-MT2-1.8B | Apache-2.0 |
| Magpie TTS Multilingual 357M | nvidia/magpie_tts_multilingual_357m | NVIDIA Open Model License: https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license |
| NanoCodec 22 kHz | nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps | NVIDIA Open Model License |
| Nemotron 3.5 ASR streaming 0.6B | nvidia/nemotron-3.5-asr-streaming-0.6b | OpenMDW 1.1: https://openmdw.ai/license/1-1/ |
| Stanza models: ar, en, es, fr, ru, zh-hans | stanfordnlp/stanza-<language> | Each model carries the licence of the treebank it was trained on (Universal Dependencies); these differ by language and some are for non-commercial use only. See https://stanfordnlp.github.io/stanza/available_models.html |

## Data

- Dictionaries (Arabic, Chinese, French, Russian, Spanish, each into English): built from Wiktionary, whose text is under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). The dictionaries are under the same licence.
- Radio stations: the community directory at https://www.radio-browser.info (public domain data), looked up live.
