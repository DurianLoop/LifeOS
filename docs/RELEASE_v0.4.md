# LifeOS v0.4.0

LifeOS v0.4.0 is a consolidated desktop and journal experience release. It
brings the v0.3 poetry, ambient audio, memorial and QR workflows together with
the repaired desktop setup path and the writing and reading redesigns completed
after that release.

## What changed

- **Desktop startup:** source setup uses an isolated `desktop/.venv`, verifies
  the real Electron binary, repairs incomplete Electron downloads, starts the
  backend from writable user data, and records a local diagnostic log when
  startup fails.
- **Writing desk (落笔):** every cell keeps the paper presentation, while edit
  mode supports drag and free resizing, alignment assistance, top anchoring,
  inline date navigation, automatic draft state and a single focused toolbar.
  Paper selectors and the duplicate formatting controls are gone.
- **Journal book (流年):** the reading surface behaves like a book with an
  internal scroll area, page turning, date search and highlighted days. The
  outer page remains stable while the book is browsed.
- **Poetry:** today's poem, history, explanations, the original text and the
  independent poetry preferences remain available. AI connection settings are
  kept in the central AI settings page instead of being duplicated in the
  classical writing flow.
- **Ambient audio:** six attributed nature recordings are bundled for offline
  playback with fade transitions, saved volume and lifecycle cleanup.
- **Memorial and QR:** users explicitly choose pages and featured stories,
  preview a snapshot, publish or update a stable URL, download an SVG QR code,
  search the public snapshot and withdraw it later.
- **AI settings:** one compact provider/key entry point supports DeepSeek, Qwen,
  GLM and compatible gateways. Model and endpoint defaults are matched by
  provider, with optional local CC Switch/Codex discovery and per-feature
  permissions. The application remains usable without an AI key.
- **Desktop companion:** the in-app companion is the only reader-side chat
  surface; the transparent floating pet avoids covering journal controls and
  can be disabled by the user.

## Verification

The focused v0.4 suite is reproducible with:

```powershell
python scripts/run_v04_release_checks.py --backend-python desktop/python-runtime/python.exe
```

It runs AI routing, poetry, ambient audio, memorial, pet, journal book,
writing desk, desktop lifecycle, backend, feature parity, Python/JavaScript
syntax and release metadata checks against temporary synthetic data. The
public release audit is separate:

```powershell
python scripts/public_release_audit.py
```

The release contains an empty Vault and derived index. Local journals,
attachments, credentials, API keys, screenshots and generated desktop output
are excluded from Git.

## Packaging

The Windows artifact is named `LifeOS-Setup-0.4.0.exe`. It is unsigned, so
Windows SmartScreen may display a warning. Build it from a clean checkout with
an x64 portable Python runtime in `desktop/python-runtime/`:

```powershell
cd desktop
npm ci
npm run dist:win -- --publish=never
```

The installer and its checksum are release assets, not repository files.
