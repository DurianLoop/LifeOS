# Core X P2 release pass

- Added mobile IndexedDB offline queue + foreground retry.
- Added tenant-scoped Cloud export and password-reconfirmed account deletion.
- Made core status inspection side-effect free (no build-machine device identity).
- Added reproducible full release suite + persisted logs/status/results.
- Updated historical Refinement IV/VI/VII compatibility assertions for the explicit 141st system and Core IX engine.

# Core IX · Living Memory · P0 + P1 · 2026-08-28

- Added durable `.lifeos/core.db` product metadata beside disposable `data/lifeos.db`.
- Bootstrapped stable Entry IDs and append-only Revision history without rewriting the 550 raw Vault files.
- Added Writer 2.0, attachments, revision preview/restore, transactional import preview/commit/rollback, and backup/restore.
- Added importer SDK support for Markdown, TXT, HTML, CSV, generic JSON, Day One JSON and ZIP bundles.
- Added 141-feature dependency/freshness state: fast deterministic/index features update immediately, corpus-derived features refresh lazily, AI artifacts become stale until regenerated.
- Reworked incremental indexing into generation-safe Lazy Refresh; stale generations are discarded if another edit arrives while the corpus snapshot is rebuilding.
- Added AI provider abstraction, Privacy Center, secure key storage, local cache, request ledger and provenance metadata.
- Added optional accounts, append-only sync operations, attachment sync, explicit optimistic conflicts and conflict resolution.
- Added reference Cloud Sync service and lightweight Web Companion.
- Productized the Electron shell for shared Windows/macOS packaging, single-instance behavior and updater hooks.
- Added Pet Event Bus v2 content firewall so ordinary companion events do not receive diary text.
- Added P0/P1 release audit, Lazy Refresh race E2E, browser QA and Core IX documentation.
- Vault remains human-readable Source of Truth; the registered 141 feature order is unchanged.


## Typography Edition

- Added a Chinese-first typography system and fluid editorial scale.
- Added Literary / Airy / Compact reading rhythms in Tweaks.
- Rebalanced Home, Journal, Search, Book and evidence typography.
- Centered Journal text on a constrained reading measure.
- Revalidated 1440 / 1024 / 768 / 390 layouts and fixed responsive regressions found by screenshot QA.
- No Vault, Memory Engine, feature-contract or AI-key changes.


## Living Memory Edition · 2026-08-28

- Added Journal **「只留这一页」** immersive reading mode: navigation and metadata recede while the original paper remains centered.
- Added an always-available immersive exit control, `Esc` exit, and automatic exit when leaving Journal so focus mode never traps navigation.
- Added a slim reading-progress rail with current section feedback and restrained local pet reading milestones.
- Added a non-gamified **today-in-archive** ritual state on Home: it only reports whether today already has a raw source.
- Added short theme **world cards** and ink/page-turn transitions without changing any underlying route, feature registry, or source contract.
- Refined loading, empty and focus-visible states so system feedback feels intentional rather than dashboard-like.
- All Living Motion is disabled by Motion Off and `prefers-reduced-motion`, and is reduced by Quiet mode.
- Added `scripts/living_memory_audit.py`; the interaction contract passes with **141 / 141** registered systems.
- Vault, schema, Memory Engine, AI defaults and raw Markdown remain unchanged.
- Managed Chromium in the build environment blocked localhost/file/data navigation during this pass, so no false browser captures are shipped; prior Typography/Theme Lab browser baselines remain in `docs/qa_*`, and this edition includes a manual spot-check checklist in `docs/qa_living_memory/README.md`.

## Theme Lab · 2026-08-28

- Added six world-scale themes without changing the 141-feature information architecture: Glass Greenhouse, Abyss Radio, Interstellar Post Office, Endless Hotel, Black Cat Observatory, and Film Summer.
- Theme differences now include material, geometry, ambient texture and component treatments rather than palette swaps only.
- Added theme descriptions in Atmosphere controls and `?theme=<id>` preview support for local QA.
- Browser-checked desktop/tablet/mobile layouts, including dark-world contrast and source-button legibility.

# Dream Edition · Modified files

## Product shell
- `app/index.html` — romantic/dreamlike shell, 4 themes, motion controls, human-facing navigation, attic, dream titles/subtitles, companion interaction, LifeOS event bus.

## AI
- `backend/server.py` — DeepSeek defaults (`https://api.deepseek.com`, `deepseek-v4-flash`) while keeping API key local-only.
- `.env.example` — safe DeepSeek template.
- `configure_ai.sh` / `configure_ai.bat` — hidden local key setup + connection test.
- `scripts/configure_ai.py` / `scripts/test_ai_connection.py` — secure configuration and smoke test helpers.

## Desktop pet
- `desktop/package.json`
- `desktop/main.cjs`
- `desktop/preload.cjs`
- `desktop/pet.html`
- `setup_desktop.sh` / `setup_desktop.bat`
- `start_desktop.sh` / `start_desktop.bat`

The desktop shell scans `~/.codex/pets/<pet-id>/pet.json + spritesheet.webp` and supports the Codex-pet v1/v2 atlas dimensions. No third-party pet artwork is bundled.

## Documentation
- `docs/DREAM_EDITION.md`
- `README.md` — Dream Edition quick start added at top.

## Verification performed
- `node --check` on LifeOS frontend script.
- `python -m py_compile backend/server.py`.
- `node --check desktop/main.cjs` and `desktop/preload.cjs`.
- `node --check` on pet renderer script.
- `python scripts/self_test.py` → `ok: true`, `feature_count: 141`.
- `/api/health` local server smoke test → local-first engine healthy; DeepSeek defaults visible without exposing a key.
- Secret scan confirms the provided API key is not embedded in the project.

## Environment limitation
The build environment could not resolve `api.deepseek.com`, so a real paid API request could not be completed here. The included `configure_ai.*` helper runs a minimal live connection test on the user's machine after the key is entered locally.

## UI/UX Pro Max refinement
- Reworked navigation icons as a consistent SVG set and strengthened keyboard focus/ARIA behavior.
- Enforced 44px+ touch targets on visible controls and 46px on key settings controls.
- Replaced the mobile 7-item/overflowing navigation with a fixed 5-item bottom bar plus an accessible “更多” panel.
- Fixed the 768px squeezed-sidebar breakpoint and the mobile fixed-nav containing-block issue.
- Recalibrated Moon/Peach/Rain/Pixel theme text/accent contrast while keeping the Dream Edition identity.
- Tightened responsive home typography, Journal spacing, and information hierarchy.
- Added browser acceptance captures and report in `docs/UI_UX_PRO_MAX_REDESIGN.md` + `docs/qa_pro_max/`.

## Beauty Pass refinement
- Added a restrained lunar date seal and archival `RAW / LOCAL` mark to Home.
- Improved paper grain, ink wash, hairlines, page-edge depth, and Journal baseline texture.
- Added tiny astronomical geometry to Home portals without introducing new dashboard cards.
- Tuned Peach from full-screen pink haze to cream paper + peach light after screenshot QA.
- Added Rain and Pixel theme-specific material treatments while preserving layout parity.
- Rechecked 390 / 768 / 1440 widths and Journal mobile; no horizontal overflow and no visible interactive target under 44px in the audited views.
- Added final screenshots and notes in `docs/BEAUTY_PASS.md` and `docs/qa_beauty/`.


## Reading Ritual Edition · 2026-08-28

- Extended `只留这一页` with a quiet section compass on desktop/tablet and a compact current-section chip on mobile.
- Added a browser-local read-to-end mark; it never writes completion state into raw Markdown or the Memory Engine.
- Fixed short-page progress math so the actual scroll boundary can reach 100%.
- Added `F` as a Journal-only immersive-reading shortcut while preserving `Esc`, `[` and `]`.
- Added desktop pet reactions for focus enter/exit, section jumps, and read-to-end events without sending diary text.
- Browser-validated 1440 / 1024 / 768 / 390 layouts through an intercepted local-API QA harness; all tested Home / Journal / Focus views have no horizontal overflow.
- Added `scripts/reading_ritual_audit.py` and `docs/READING_RITUAL_EDITION.md`.
- Vault, feature registry, schema, DeepSeek defaults, themes, and raw source contracts remain unchanged.


## Core IX · P0 + P1 Final Release Gate

- Re-ran Vault 550/550 integrity and 141/141 feature-order checks.
- Re-ran Core IX E2E for Revision, transactional import/rollback, backup/restore, sync, conflicts, attachments, and AI provenance/cache.
- Re-ran generation-safe Lazy Refresh race test; the audited fast reindex was ~192 ms and superseded generations were discarded.
- Re-ran multi-format importer and cloud tenant-isolation release audit.
- Added `docs/P0_P1_FINAL_RELEASE.md` and retained machine-readable/log QA under `docs/qa_p0p1_final/`.
- Managed Chromium blocks localhost/file navigation in the build sandbox; no false direct-browser E2E claim is made. Real API E2E and existing desktop/mobile browser layout QA are retained separately.
- Production signing/notarization and public Cloud/TLS remain external deployment steps requiring owner credentials.

## Core X · P2 Personal Memory Platform · 2026-08-28

- Added tenant-isolated profiles, subscriptions/entitlements, Memory Inbox, notifications, shares, Cloud AI usage and P2 sync state.
- Added iOS/Android Mobile Companion shell with Today / Write / Inbox / Ask / Me, photo capture and voice capture.
- Added Calendar ICS + Generic JSON Connector SDK; imported external memories land in Inbox before becoming an Entry/Revision.
- Added optional AES-256-GCM sync E2EE with an explicit local Recovery Key shared across Desktop, Mobile and Web Companion; the reference cloud never stores that key.
- Upgraded Web Companion to decrypt/encrypt E2EE entries client-side when the user supplies the Recovery Key.
- Added explicit immutable share snapshots with expiration and revocation; journal edits do not silently mutate existing shares.
- Added memory-native notification generation for old letters and unlocked time capsules without streak/gamification pressure.
- Added safe Marketplace foundation for Importer / Connector / Pet manifests; executable package fields are rejected by default.
- Added Free / Plus / Pro entitlement model, Stripe Checkout adapter and signed Stripe webhook processing. No billing keys are bundled.
- Added BYOK / Local / LifeOS Cloud AI / Disabled product routing while preserving non-AI archive functionality.
- Added P2 browser, tenant-isolation, encryption, marketplace, billing, mobile/static and cross-device E2E tests.
- Kept the 550-source Vault and 141-feature analysis registry intact.
