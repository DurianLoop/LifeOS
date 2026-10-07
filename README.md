# LifeOS v0.5.0

LifeOS is a local-first journal and personal memory workspace, with an editable writing desk, journal book, and desktop companion.

## New in v0.5.0

- **Your sidebar:** enter the editor from Appearance, lift and drag features to reorder them or tuck them into Attic, bring them back, cancel changes or restore defaults. Navigation preferences survive desktop restarts.
- **A short welcome:** new installations offer writing, importing or looking around in one screen. Existing users and restored journals skip it. AI setup stays optional.
- **A companion of your choice:** browse pets in one, two or four columns and right-click each character to repeat an action. ViVi keeps its 14 original GIFs, native movement, drag reactions and hide/reappear behavior. All installed pets, including Desk Otter, can be removed and restored.
- **Independent desktop pets:** choose in-app or desktop placement from the companion room settings, adjust size and topmost behavior, and keep the desktop pet when closing the journal window. The tray can reopen LifeOS or fully quit it.
- **Help when asked:** companion chat searches the bundled product guide for the current question, cites feature entries and offers local steps when AI is unavailable.

[Release notes](docs/RELEASE_v0.5.0.md) · [v0.5.0 release](https://github.com/DurianLoop/LifeOS/releases/tag/v0.5.0)

## New in v0.4.3

**Drift Bottle:** write a letter, record audio or video, and seal it until a chosen future time. Offline sea backgrounds, durable drafts, timed opening, in-app arrivals and native desktop reminders make the reunion feel personal. Bottles stay outside journal retrieval and AI, and their media is included in workspace backups.

[v0.4.3 release](https://github.com/DurianLoop/LifeOS/releases/tag/v0.4.3)

## New in v0.4.2

- **Durable drafts:** text, unsubmitted attachments, desk layout, fonts and sidebar preferences survive desktop restarts and backend port changes. Existing browser-origin drafts are migrated into the workspace.
- **Save and close protection:** persistence failures remain visible, unfinished writes keep the editor available, and closing checks the latest draft and attachments. Attachment retries avoid duplicate uploads.
- **Recoverable backups:** backups include drafts and preferences, verify their contents before restore, and apply on restart with interruption rollback. Retained safety backups stay discoverable after restoring older metadata.
- **Desktop updates:** check, download, cancel, retry and restart to install, with draft persistence and a safety backup before installation.

[Release notes](docs/RELEASE_v0.4.2.md) · [v0.4.1 improvements](docs/RELEASE_v0.4.1.md) · [AI quality evaluation](docs/AI_QUALITY_ACCEPTANCE.md)

## Included from v0.4

- **Daily poetry:** choose a poem for the current journal, read the original and explanation, and revisit past selections. Automatic recommendations are opt-in and require your configured AI provider.
- **Ambient recordings:** six real nature recordings bundled for offline playback, with smooth loops, sound switching and saved volume. [Sources and licenses](docs/WHITE_NOISE.md) are included.
- **Memorial page and QR code:** explicitly select journal pages, preview a public snapshot, highlight stories, publish or update a stable URL, download an SVG QR code, and withdraw the page. The public page supports search and optional AI answers grounded in the selected snapshot.
- **Desktop startup fixes:** packaged resources resolve correctly, the included Python initializes a clean index, occupied ports are handled, and startup errors include a local diagnostic log. User data lives in a writable folder and survives app updates.
- **Simple AI settings:** choose your provider and API key; model and endpoint are filled automatically. Supports Qwen, DeepSeek, GLM and other providers, with optional automatic CC Switch/Codex integration. See [AI 设置与 Codex 接入](docs/AI设置与Codex接入.md).
- **Writing desk refresh:** paper cells keep the original writing feel while supporting drag, resize, alignment assistance, top anchoring, inline date navigation and a focused editing toolbar.
- **Journal book:** the 流年 view reads like a book, with internal scrolling, page navigation, date highlighting and direct jumps without a second desktop pet overlay.
- **Companion stability:** the in-app companion chat stays beside the pet, the transparent floating window avoids intercepting journal controls, and the desktop companion remains optional.

## Windows download

Download [LifeOS-Setup-0.5.0.exe](https://github.com/DurianLoop/LifeOS/releases/download/v0.5.0/LifeOS-Setup-0.5.0.exe) from the [v0.5.0 release](https://github.com/DurianLoop/LifeOS/releases/tag/v0.5.0). Python is included. This community build is unsigned.

Installed app data is stored under `%APPDATA%/LifeOS/workspace/`; startup diagnostics are under `%APPDATA%/LifeOS/logs/desktop.log`. Back up the workspace folder to preserve journals, revisions and settings. Source runs continue to use the repository folder.

## Privacy and memorial hosting

The repository and installer contain no author journals, attachments, revision history, credentials or user databases. The installer creates an empty local workspace on first launch. Local `vault/`, `data/`, `.lifeos/` and `.env` are excluded from publication.

Daily poetry uses only the selected day's journal when you request a recommendation or enable automatic recommendations. Companion chat uses the current conversation and matching public product-guide cards when asked about LifeOS. Memorial publication sends only the explicitly selected snapshot; later journal changes remain private until you publish again.

A public memorial URL requires a configured Netlify site (or the provided development server), a publishing key and an explicit publish action. Optional memorial AI additionally needs an available model gateway. GitHub release publication does not publish your journals or create a public memorial automatically. See [纪念页与二维码](docs/纪念页与二维码.md) for hosting and QR instructions.

## Run from source

Requirements: Python 3.11+ and Node.js 20+.

```powershell
.\setup_desktop.bat
```

Setup creates the isolated `desktop/.venv` environment and checks the real Electron executable before reporting success. It never installs packages into your shared Anaconda/system Python. Run `.\start_desktop.bat` for subsequent launches. For setup without opening a window, use `.\setup_desktop.bat --no-launch`.

On macOS/Linux, run `./setup_desktop.sh`. For browser mode, install `requirements.txt` and run `start.bat` / `start.sh`.

## Build a Windows installer

Place an x64 CPython runtime in `desktop/python-runtime/` and install `requirements.txt` plus Pillow in that runtime. For an embedded Python build, enable `import site` and `Lib/site-packages` in its `._pth` file. Then run:

```powershell
cd desktop
npm ci
npm run dist:win -- --publish=never
```

The installer, blockmap and update metadata are written to `desktop/dist/`. Keep runtimes, build outputs and all local data out of Git.

## License and pet assets

Application code uses the repository license. Bundled pet assets retain their upstream attribution and licenses in `app/assets/pets/`. Gallery pet packages are downloaded only when explicitly installed.
