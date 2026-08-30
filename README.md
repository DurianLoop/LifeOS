# LifeOS V0.1

LifeOS is a local-first journal: write a page, retain revisions, import old journals, search your own archive, and keep a small desktop companion nearby.

## Privacy

This repository and the Windows installer ship with an **empty Vault**. They contain no diaries, database, attachments, revision history, settings, API keys, screenshots, or personal QA records from the author.

Your own material is created locally and ignored by Git:

- `vault/` — human-readable journal Markdown
- `data/` — local derived index
- `.lifeos/` — local revisions, attachments, backups, settings and secrets
- `.env` — optional AI configuration

The optional companion chat sends only the text in its current conversation to the model you configure; it does not read your journal pages.

## Windows desktop app

Download the `LifeOS-Setup-0.1.0.exe` asset from the v0.1 release, install it, then open **LifeOS** from the Start menu. The installer includes the local backend; Python is not required for ordinary use.

Windows may show a SmartScreen warning because this community build is not code-signed. Review the repository and release checksums before choosing to run it.

## Run from source

Requirements: Python 3.11+ and Node.js 20+.

```powershell
python -m pip install -r requirements.txt
.\setup_desktop.bat
```

For browser mode, run `.\start.bat`. It creates the first local index from the empty Vault. Import or write a journal page to begin.

## Build a Windows installer

From `desktop/`:

```powershell
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --clean --onedir --name LifeOSServer --collect-all cryptography server_bootstrap.py
Move-Item .\dist\LifeOSServer .\server-dist
npm ci
npm run dist:win
```

The generated NSIS installer is in `desktop/dist/`. Do not add generated `vault/`, `data/`, `.lifeos/`, `.env`, or `desktop/server-dist/` to Git.

## License and pet assets

LifeOS application code is released under the repository license. Bundled companion assets retain their individual upstream attribution and licenses in `app/assets/pets/`. The in-app gallery only permits the licenses marked for personal/non-commercial use.
