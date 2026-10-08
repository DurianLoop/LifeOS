<div align="center">

<img src="docs/images/readme/mark.svg" width="76" height="76" alt="LifeOS · pages and bookmarks" />

# LifeOS

### Write today. Let your memories find their way back.

<p>A local-first journal and a space for your personal memories.<br />Write at a desk that feels like paper, turn the pages of your past, and keep a little companion by your side.</p>

[![Version](docs/images/readme/badge-version.svg)](https://github.com/DurianLoop/LifeOS/releases/tag/v0.5.2) [![Platform](docs/images/readme/badge-platform.svg)](#download) [![Local first](docs/images/readme/badge-local.svg)](#privacy) [![License](docs/images/readme/badge-license.svg)](LICENSE.md)

[中文](README.md) · **English** · [Changelog](https://github.com/DurianLoop/LifeOS/releases)

**[Download](#download) · [Preview](#preview) · [Features](#features) · [Quick start](#quick-start) · [FAQ](#faq)**

<br />

<a href="docs/images/readme/desk.png"><img src="docs/images/readme/desk.png" width="1200" alt="LifeOS writing desk with a fictional Chinese journal entry, sidebar navigation, and a habit checklist" /></a>

<sub>Actual LifeOS v0.5.2 interface · All text shown in the screenshots is fictional demo content. No private journals are included.</sub>

</div>

<br />

LifeOS brings writing, reading, and remembering into one quiet space. Use it as a simple journal, bring in your old entries, draw a memory at random, or seal a letter to open in the future. AI is optional; everyday journaling needs no model setup.

<a id="download"></a>

## Download and install

**Version featured here: v0.5.2.** The installers include a Python runtime. You do not need to install Python or Node.js separately.

| Platform | Installer | Getting started |
| :--- | :--- | :--- |
| **Windows x64** | [Download .exe](https://github.com/DurianLoop/LifeOS/releases/download/v0.5.2/LifeOS-Setup-0.5.2.exe) | Run the installer, then open LifeOS from the Start menu |
| **macOS · Apple Silicon** | [Download .dmg](https://github.com/DurianLoop/LifeOS/releases/download/v0.5.2/LifeOS-0.5.2-mac-arm64.dmg) | For M-series chips; drag LifeOS into Applications |
| **macOS · Intel** | [Download .dmg](https://github.com/DurianLoop/LifeOS/releases/download/v0.5.2/LifeOS-0.5.2-mac-x64.dmg) | For Intel Macs; drag LifeOS into Applications |

[All release files and checksums](https://github.com/DurianLoop/LifeOS/releases/tag/v0.5.2) · [Report an issue](https://github.com/DurianLoop/LifeOS/issues)

<details>
<summary>First-launch notes and other platforms</summary>

- The Windows community build is not code-signed, so Windows may show a SmartScreen prompt.
- macOS requires **macOS 11 or later**. This build uses ad-hoc signing and is not notarized by Apple. After verifying the download source, you may need to allow it in **System Settings → Privacy & Security**.
- There is no prebuilt Linux installer for this release. You can [run from source](#source).
- For checksums, use `SHA256SUMS.txt` for Windows and `SHA256SUMS-macos-v0.5.2.txt` for macOS, both available on the release page.

</details>

<a id="preview"></a>

## One desk, a few ways to spend time with your memories

<table>
<tr>
<td width="50%" valign="top">
<h3>Journal · Turn your days into a book</h3>
<a href="docs/images/readme/journal.png"><img src="docs/images/readme/journal.png" alt="Journal: a book-style reading view" /></a>
<p>Browse by date or jump from the contents, bringing scattered entries back into a timeline.</p>
</td>
<td width="50%" valign="top">
<h3>Memory draw · Meet an old day again</h3>
<a href="docs/images/readme/memory.png"><img src="docs/images/readme/memory.png" alt="Memory draw: rediscovering an old entry and opening its source" /></a>
<p>Draw an old page, an echo, or a clue. Open the original entry and leave a colorful bookmark.</p>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>Drift bottles · Write to your future self</h3>
<a href="docs/images/readme/bottles.png"><img src="docs/images/readme/bottles.png" alt="Drift bottles: sealing a letter to the future with a scheduled opening time" /></a>
<p>Seal away words, sound, or video, and open them when the time comes.</p>
</td>
<td width="50%" valign="top">
<h3>Companions · A little company at your desk</h3>
<a href="docs/images/readme/companion.png"><img src="docs/images/readme/companion.png" alt="Companions: pet characters and display settings" /></a>
<p>Choose a character to keep you company inside LifeOS or as a separate desktop pet.</p>
</td>
</tr>
</table>

<a id="features"></a>

## Give your entries room to become memories

| | What you can do |
| :--- | :--- |
| **Write and read** | Write on movable, resizable paper panels and read in a book view. Keep revisions and return to original entries by date. |
| **Import and search** | Import Markdown, TXT, HTML, JSON, CSV, and Day One JSON. Search your archive and follow results back to the original text. |
| **Memory draws and bookmarks** | Revisit the past through old pages, echoes, and clues, with recently drawn results kept out of the next draws. Colorful bookmarks survive restarts. |
| **Letters to the future** | Save drafts with text, audio, or video, choose an opening time, and receive reminders when it arrives. Bottle content is included in workspace backups. |
| **Companions and atmosphere** | Choose ViVi or another character, keep a pet on your desktop, and listen to six offline nature sounds. Arrange your sidebar and tuck less-used features into the Attic. |
| **Optional AI** | Ask questions grounded in journal evidence, revisit the perspective of your past self, rewrite text in classical Chinese, get poetry recommendations, or chat with a companion. Connect a model API, a supported local CC Switch / Codex setup, or the Ollama Demo. |
| **Backup and recovery** | Workspace backups include journals, attachments, drafts, and preferences. Backups are validated before restoration; Windows desktop updates save drafts and create a safety backup before installation. |
| **Sharing by choice** | Select entries, preview them, and publish a memorial page with a QR code. A separately configured hosting service is required. |

### v0.5.2: Rediscover an old day and leave a bookmark

- **Three ways to draw:** old pages, echoes, and clues all link to their original text. Newly saved entries are available immediately.
- **Leave a trail:** add a colorful bookmark from a drawn entry and see it on both the page and in the contents. Remove it whenever you like.
- **Keep your place:** returning to the draw preserves the current result. Consecutive draws avoid recent results, and failed requests can be retried.
- **A calmer interface:** the poetic Chinese mode now uses “拾诗” and “旧笺” consistently, with refinements to the slim ambient-audio slider, companion layout, and narrow-window views.

[Read the full release notes →](https://github.com/DurianLoop/LifeOS/blob/v0.5.2/docs/RELEASE_v0.5.2.md)

<a id="quick-start"></a>

## Start with your first entry

1. **Install and open LifeOS.** On the welcome screen, write your first entry, import old journals, or take a look around.
2. **Write about today in the writing desk (落笔).** Save your entry, then read it in the journal (流年). You can also begin by importing an existing archive.
3. **Make the desk your own.** Choose a companion, turn on nature sounds, and arrange the sidebar to suit your habits.
4. **Set up AI when you want it.** Open **AI settings** at the bottom of the sidebar, choose a provider, save your settings, and test the connection. For Ollama, first install Ollama locally and download a model.

[Product guide](https://github.com/DurianLoop/LifeOS/blob/v0.5.2/docs/PRODUCT_HELP.md) · [AI settings and integrations](https://github.com/DurianLoop/LifeOS/blob/v0.5.2/docs/AI设置与Codex接入.md) · [Ollama Demo](https://github.com/DurianLoop/LifeOS/blob/v0.5.2/docs/OLLAMA_DEMO.md)

<a id="privacy"></a>

## Your journal stays local. You choose the connections.

Release builds start with an empty workspace. Original entries, attachments, revisions, and settings are stored on your computer. Everyday writing, reading, search, and nature sounds do not depend on an AI service.

| When you use… | Where the data goes |
| :--- | :--- |
| Local writing, reading, and search | Processed in your local workspace. |
| AI journal questions / Past Me | The current question and selected journal evidence are sent to your configured model. |
| AI classical-Chinese rewriting / personalized poetry | Relevant input, such as the current text or that day's entry, is sent to the model. Automatic poetry recommendations require a separate opt-in and may then send that day's text automatically. |
| Companion chat | Uses the current conversation and relevant public product guidance. It does not read your journal text. |
| Public memorial pages | Only explicitly selected and published snapshots go online. Later journal edits do not automatically update the public page. |

Cloud models receive the content of the requests you send to them. The Ollama Demo can use a local model that you download yourself; LifeOS installers do not include a large language model.

**Installed desktop app workspace locations:**

- Windows: `%APPDATA%/LifeOS/workspace/`
- macOS: `~/Library/Application Support/LifeOS/workspace/`

We recommend making regular workspace backups and keeping a copy on another drive. Source builds use the project directory by default. See [Memorial pages and QR codes](https://github.com/DurianLoop/LifeOS/blob/v0.5.2/docs/纪念页与二维码.md) for deployment and unpublishing instructions.

<a id="faq"></a>

## FAQ

<details>
<summary><strong>Can I use LifeOS without setting up AI?</strong></summary>

Yes. Writing, reading, search, statistics, ambient audio, and rule-based analysis do not require a text model. Enable the relevant AI features when you want generated content.

</details>

<details>
<summary><strong>Can I bring in my old journals and export them later?</strong></summary>

The built-in importers support Markdown, TXT, HTML, generic JSON, CSV, and Day One JSON. You can export Markdown, JSON, or CSV; use a workspace backup to preserve attachments, drafts, and settings together. Fields vary between source formats, so check the imported entries in the journal view.

</details>

<details>
<summary><strong>Are drift bottles sent to other people? Will I always get a reminder?</strong></summary>

Drift bottles are local letters to your future self, rather than a service for exchanging messages with strangers. Desktop reminders require LifeOS to be running. If you fully quit the app, no reminder appears while it is closed; you can view bottles that are ready when you next open it.

</details>

<details>
<summary><strong>Can the desktop pet stay after I close the main window?</strong></summary>

Yes. In companion settings, choose the separate desktop mode and enable keeping the pet after the main window closes. Use the tray menu to reopen LifeOS or quit the app completely.

</details>

<details>
<summary><strong>Why do the source instructions specify a version?</strong></summary>

The README on main describes the current release, while the application source on main is still an earlier version. To use the features shown here, download a v0.5.2 installer or check out the v0.5.2 source using the commands below.

</details>

<a id="source"></a>

## Run from source

You need **Python 3.11+, Node.js 20+, and Git**. Check out the release version featured on this page:

```bash
git clone --branch v0.5.2 --depth 1 https://github.com/DurianLoop/LifeOS.git
cd LifeOS
```

Windows:

```powershell
.\setup_desktop.bat
```

macOS / Linux:

```bash
bash setup_desktop.sh
```

The setup script creates an isolated `desktop/.venv` environment and checks Electron. After setup, use `start_desktop.bat` / `bash start_desktop.sh` to launch LifeOS. Add `--no-launch` to the setup command to install without launching.

<details>
<summary>Browser mode and building an installer</summary>

For browser mode, first install `requirements.txt`, then run `start.bat` / `bash start.sh`.

To build a Windows installer, place an x64 CPython runtime in `desktop/python-runtime/` and install `requirements.txt` and Pillow into that runtime. For embeddable Python, also enable `import site` and `Lib/site-packages` in `._pth`. Then run:

```powershell
cd desktop
npm ci
npm run dist:win -- --publish=never
```

Build output is written to `desktop/dist/`. Keep local workspaces, credentials, runtimes, and build output out of Git.

</details>

## License and thanks

LifeOS application code is available under a [personal, non-commercial license](LICENSE.md). Companion artwork retains each creator's attribution and license; check the [asset directory for this release](https://github.com/DurianLoop/LifeOS/tree/v0.5.2/app/assets/pets) before use. Nature recording sources are listed in [Sounds and licenses](https://github.com/DurianLoop/LifeOS/blob/v0.5.2/docs/WHITE_NOISE.md).

Thank you to the companion artists and everyone who has tried LifeOS or shared feedback. If this little desk feels useful, a Star is welcome—and so are [issues and suggestions](https://github.com/DurianLoop/LifeOS/issues).

<div align="center">

<br />

**Write this moment down. Leave it for your future self.**

[Download LifeOS](#download) · [Back to top](#lifeos)

</div>
