# LifeOS Mobile · P2

Mobile is intentionally a **capture and companion surface**, not a compressed
copy of the 141-system desktop laboratory.

Primary surfaces: Today, Write, Memory Inbox, Ask, Me.

The `www/` app runs as a PWA/static web app and is also the Capacitor webDir.
Capacitor 8.5.x is pinned for iOS/Android project generation. Native signing,
provisioning and store submission require the product owner's Apple/Google
credentials.

Photo capture uses an `<input capture>` path and voice capture uses
`MediaRecorder`; both land in Memory Inbox first. This keeps capture reversible:
accepting an item creates a normal Entry + Revision later on Desktop.

## Offline and account portability

Mobile queues failed network writes in IndexedDB and retries them in the foreground after reconnect/login. This covers journal operations and Memory Inbox captures; conflicts remain queued for explicit resolution instead of being discarded.

The Me surface also exposes tenant-scoped cloud export and destructive account deletion. Account deletion requires password re-authentication plus the exact confirmation phrase `DELETE MY LIFEOS`.
