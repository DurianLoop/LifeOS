# LifeOS Connectors · P2

Connectors feed **Memory Inbox**. They do not write directly into the Vault.
Every connector produces a normalized inbox item that the user can accept,
dismiss, or convert into a journal entry.

Built-in safe adapters:

- `generic-json`: JSON payload/file -> Memory Inbox
- `calendar-ics`: local `.ics` export -> Memory Inbox event summaries

OAuth connectors (mail, calendar providers, photos) require provider credentials
and are represented by the same contract, but this repository does not ship
third-party client secrets.
