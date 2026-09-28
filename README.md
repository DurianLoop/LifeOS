# LifeOS v0.3

LifeOS is a local-first journal and personal memory workspace, with an editable writing desk, journal book, and desktop companion.

## New in v0.3

- **Daily poetry:** choose a poem for the current journal, read the original and explanation, and revisit past selections. Automatic recommendations are opt-in and require your configured AI provider.
- **White noise:** ten locally generated soundscapes, with playback, switching and saved volume controls. No audio download or account is required.
- **Memorial page and QR code:** explicitly select journal pages, preview a public snapshot, highlight stories, publish or update a stable URL, download an SVG QR code, and withdraw the page. The public page supports search and optional AI answers grounded in the selected snapshot.
- **Desktop startup fixes:** packaged resources resolve correctly, the included Python initializes a clean index, occupied ports are handled, and startup errors include a local diagnostic log. User data lives in a writable folder and survives app updates.

## Windows download

Download [LifeOS-Setup-0.3.1.exe](https://github.com/DurianLoop/LifeOS/releases/download/v0.3.1/LifeOS-Setup-0.3.1.exe) from the [v0.3.1 release](https://github.com/DurianLoop/LifeOS/releases/tag/v0.3.1). Python is included. This community build is unsigned.

Installed app data is stored under `%APPDATA%/LifeOS/workspace/`; startup diagnostics are under `%APPDATA%/LifeOS/logs/desktop.log`. Back up the workspace folder to preserve journals, revisions and settings. Source runs continue to use the repository folder.

## Privacy and memorial hosting

The repository and installer contain no author journals, attachments, revision history, credentials or user databases. The installer creates an empty local workspace on first launch. Local `vault/`, `data/`, `.lifeos/` and `.env` are excluded from publication.

Daily poetry uses only the selected day's journal when you request a recommendation or enable automatic recommendations. Companion chat uses the current conversation. Memorial publication sends only the explicitly selected snapshot; later journal changes remain private until you publish again.

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
npm run dist:win -- --publish never
```

The installer, blockmap and update metadata are written to `desktop/dist/`. Keep runtimes, build outputs and all local data out of Git.

## License and pet assets

Application code uses the repository license. Bundled pet assets retain their upstream attribution and licenses in `app/assets/pets/`. Gallery pet packages are downloaded only when explicitly installed.
