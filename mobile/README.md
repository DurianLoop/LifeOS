# LifeOS Mobile v0.6.0

## New iOS implementation

The focused native iOS rewrite lives in [`ios-native/`](ios-native/README.md): SwiftUI, native Liquid Glass on iOS 26, notes, journals, search and a local library. Generate its Xcode project with `python3 ios-native/generate_project.py`. The source and simulator build are the delivery target; no signed iPhone distribution is included.

The Briefcase iOS commands below describe the legacy client, retained for migration testing. Android continues using the Briefcase client.

The native apps bundle the full desktop web application and Python engine.
Journals, SQLite, revisions, attachments, preferences, imports, exports,
encryption and backups run in the private application sandbox, offline.

## Build

Use Python 3.13 and Briefcase 0.4.6. iOS requires macOS and Xcode.
Android requires Java 17 and an Android SDK; Briefcase can install these.

```sh
python -m pip install briefcase==0.4.6
python scripts/prepare_mobile_resources.py
python -m pip install imageio-ffmpeg==0.6.0 Pillow
python scripts/prepare_mobile_pet.py
cd mobile
briefcase create android --no-input
python ../scripts/configure_android_project.py
briefcase build android --no-input
briefcase run android
# On macOS:
briefcase create iOS --no-input
briefcase build iOS --no-input
briefcase run iOS --no-input -d auto
```

Run native acceptance with `briefcase run <platform> --test --update`.
Production builds must be updated and rebuilt without `--test`.
The generated resources directory is ignored; its bundle manifest records all
public resource digests. Private workspace data is never a build input.

iOS v0.6.0 delivers source and an Apple Silicon simulator app only.
No iPhone installation package or TestFlight distribution is included.

Desktop tray, desktop overlay, close-to-tray and desktop auto-updater do not
exist on iOS/Android. The companion stays inside the app. Due bottles remain
visible when opened. Network AI and LAN endpoints are supported; desktop
Codex/CC Switch executables cannot run on a phone.

`www/` and `capacitor.config.json` retain the historical P2 companion source.
The v0.6.0 native build uses `src/` and `pyproject.toml`. The separate website
PWA remains in `promo/app/`, retaining its existing storage format.
