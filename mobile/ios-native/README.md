# LifeOS · Native iOS

A focused SwiftUI rewrite: notes, journals, full-text search, notebooks, tags, internal links and backlinks, attachments, revisions, reversible trash, Markdown import/export and portable backups. iOS 26 uses the real system Liquid Glass API for controls and navigation. iOS 17–18 have a native material fallback. Documents remain opaque for readability.

Requires macOS and Xcode 26 or newer. No third-party libraries are required.

```sh
cd mobile/ios-native
python3 generate_project.py
swift test
open LifeOS.xcodeproj
# Choose an iPhone simulator, then Run.
xcodebuild test -project LifeOS.xcodeproj -scheme LifeOS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

The generated project and runtime data are ignored. GitHub Actions builds on macOS 26, runs storage/migration and UI tests, captures real native screenshots and produces both a clean Apple Silicon simulator archive and an unsigned arm64 iPhone IPA for local signing. The IPA can be signed on Windows using Sideloadly and a personal Apple account; free provisioning expires after seven days. See [the iPhone installation guide](INSTALL_IPHONE.md). Apple credentials never belong in this repository.

To use the simulator archive on an Apple Silicon Mac, unzip it, open an iOS 26 iPhone in Xcode's Simulator, then run:

```sh
xcrun simctl install booted /absolute/path/to/LifeOS.app
xcrun simctl launch booted life.lifeos.lifeosmobile
```

The native interface supports iOS 17 and newer; real Liquid Glass requires iOS 26. The archive is built for the arm64 simulator and cannot be installed on a physical iPhone. Normal launches contain no sample notes.

For an iPhone build from source, automatic signing is enabled. Select your Team in Xcode, or set `LIFEOS_APPLE_TEAM_ID` when generating the project. `LIFEOS_IOS_BUNDLE_ID` can select a bundle identifier owned by your team. CI explicitly disables signing and does not install unsigned artifacts onto a phone. TestFlight is not configured.

Interaction refinements in 0.7.1 include standard navigation with swipe back, automatic initial writing focus, empty draft cleanup, reversible deletion with an undo banner, recent local searches and matching body excerpts, and previous/next-week navigation with a return-to-today action. Reading keeps its native system controls and opaque paper surface.

The original bundle ID is retained for future signed upgrades. Legacy workspaces in the same sandbox can be imported via preview. A desktop or old iOS ZIP backup can also be selected from Files. New backups are JSON documents containing the complete library and attachment bytes; import merges and preserves conflicting copies. Normal launches start empty. Test-only sample content requires explicit UI-test launch arguments and a separate storage directory.

Data stays in Application Support/LifeOSNative. A previous snapshot is retained before each atomic write. A failed read never silently overwrites an unreadable library. All deletion goes to reversible Trash. Backups are portable, not additionally encrypted, and need to be kept in a trusted location. There is no automatic multi-device synchronization.

See [the design and scope](../../docs/IOS_REBUILD.md). Existing desktop, website and Android clients are unaffected by this target.
