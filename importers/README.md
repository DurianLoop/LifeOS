# LifeOS Importer SDK

Every importer converts external data into the same `EntryDraft` contract:
`journal_date`, `title`, `content`, `tags`, `timezone`, `source_format`, and `original_metadata`.

Built-ins: Markdown, TXT, HTML, generic JSON, CSV, and Day One JSON exports.
Obsidian/Notion Markdown folders work through the Markdown batch importer. New importers only need to implement `Importer.parse()` and register in `IMPORTERS`.
