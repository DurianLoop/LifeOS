# LifeOS v0.6.0

Full application migration to macOS, Android and iOS simulator, retaining the
paper-style typography, original 142 feature pages, writing and reading tools,
AI settings, attic, poetry, memory draw, bottles, pets and local data engine.

Mobile apps contain a local Python runtime and keep data in a private sandbox.
The desktop and mobile apps share the same business code and backup format.
Drafts and preferences persist independently of the temporary loopback port.
Mobile imports use the system file picker; exports use Android's document
provider or the iOS share sheet.

iOS delivery: source and Apple Silicon simulator build only. No iPhone package,
Apple signing or TestFlight submission is included.

Platform differences: mobile pets stay in the application; desktop overlay,
tray, desktop executable integrations and the desktop automatic installer have
no mobile equivalent. Due bottles can be reviewed when the app is opened.
Configured network AI providers require connectivity; local archive features
work offline. The bundled DSH pet assets prohibit commercial use and retain
their upstream notices.

Acceptance reports and SHA-256 checksums accompany the release assets.

See [the platform parity and acceptance scope](PLATFORM_PARITY_v0.6.0.md).
