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

The generated project and runtime data are ignored. GitHub Actions builds on macOS 26, runs storage/migration and UI tests, captures real native screenshots and produces a clean Apple Silicon simulator archive. Source and simulator are the deliverables; an iPhone install or TestFlight distribution needs a separately configured Apple signing identity.

To use the simulator archive on an Apple Silicon Mac, unzip it, open an iOS 26 iPhone in Xcode's Simulator, then run:

```sh
xcrun simctl install booted /absolute/path/to/LifeOS.app
xcrun simctl launch booted life.lifeos.lifeosmobile
```

The native interface supports iOS 17 and newer; real Liquid Glass requires iOS 26. The archive is built for the arm64 simulator and cannot be installed on a physical iPhone. Normal launches contain no sample notes.

The original bundle ID is retained for future signed upgrades. Legacy workspaces in the same sandbox can be imported via preview. A desktop or old iOS ZIP backup can also be selected from Files. New backups are JSON documents containing the complete library and attachment bytes; import merges and preserves conflicting copies. Normal launches start empty. Test-only sample content requires explicit UI-test launch arguments and a separate storage directory.

Data stays in Application Support/LifeOSNative. A previous snapshot is retained before each atomic write. A failed read never silently overwrites an unreadable library. All deletion goes to reversible Trash. Backups are portable, not additionally encrypted, and need to be kept in a trusted location. There is no automatic multi-device synchronization.

See [the design and scope](../../docs/IOS_REBUILD.md). Existing desktop, website and Android clients are unaffected by this target.
