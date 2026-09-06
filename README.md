# LifeOS v0.2

LifeOS is a local-first journal and personal memory workspace. Write on a
customizable grid, retain revisions, import past journals, revisit pages as a
book, and keep your material on your own device.

## What is new in v0.2

- A responsive PC writing desk with day, week, month, and year views.
- Direct grid arrangement: drag cards, rename them, choose 1x1, 1x2, 2x1,
  or 2x2, and save layouts as templates.
- Habits are ordinary editable grid cards rather than a separate panel.
- Date jump, inline formatting, theme-consistent scrolling, and a faster
  writing-page transition.
- The Other room is a first-class page, alongside Today and Journal.

## Privacy

This repository contains no author diaries, databases, attachments, revisions,
settings, credentials, screenshots, or QA records. The tracked vault and data
directories contain only empty placeholders.

Your own material stays local and is ignored by Git:

- vault/ — journal Markdown
- data/ — local search/index data
- .lifeos/ — revisions, attachments, backups, settings, and secrets
- .env — optional AI configuration

The optional companion chat only sends text that you explicitly enter into its
current conversation. It does not read journal pages by itself.

## Run from source

Requirements: Python 3.11+ and Node.js 20+.

~~~powershell
python -m pip install -r requirements.txt
.\setup_desktop.bat
~~~

For browser mode, run .\start.bat. It creates a local empty index; import or
write a page to begin.

## Build a Windows installer

To create an installer, place a compatible CPython runtime in
desktop/python-runtime/, then run:

~~~powershell
cd desktop
npm install
npm run dist:win
~~~

The installer is written to desktop/dist/. Do not add generated runtime data,
.env, or the bundled Python runtime to source control.

## License and pet assets

LifeOS application code is released under the repository license. Bundled
companion assets retain their own upstream attribution and licenses under
app/assets/pets/.
