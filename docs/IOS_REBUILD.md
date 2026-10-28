# LifeOS iOS · A quiet place to think

The iOS app is rebuilt in native SwiftUI under `mobile/ios-native/`. The old Briefcase client remains available as a legacy migration source and as the Android implementation. The new iOS app keeps the original bundle identifier `life.lifeos.lifeosmobile` so a future signed upgrade can retain the existing sandbox.

Four destinations replace the desktop module directory: notes, journal, search, and library. The core is offline writing and Markdown reading, notebooks, tags, pinned notes, internal links/backlinks, attachments, revision recovery, trash, import and a complete portable backup. AI, desktop pets, analysis dashboards and time capsules are outside this focused rebuild.

Visual direction: warm white paper, charcoal typography, a restrained evergreen accent, precise dividers, generous readable line spacing. Inspired by the organization of Notion and the local Markdown model of Obsidian; original LifeOS identity. Glass belongs to navigation and controls, with opaque document surfaces underneath. iOS 26 uses native Liquid Glass; iOS 17–18 use system material. Dynamic Type, VoiceOver, dark appearance, Reduce Motion and Reduce Transparency are supported.

Data is local in Application Support/LifeOSNative, with atomic writes and a previous known-good snapshot. Changes save while typing and when the editor backgrounds or closes; a failed save stays visible and remains editable for retry. A corrupt store never silently becomes an empty library. Full backup imports merge by stable identity and preserve conflicts as separate copies. Deletion is reversible in Trash. Legacy workspaces are read without modifying the original database or files, including revision and attachment records and recoverable writer drafts. Import previews show the number of notes before committing.

Delivery remains source and an Apple Silicon iOS simulator build. No iPhone installation, Apple signing identity, TestFlight distribution or App Store submission is included. Simulator acceptance uses disposable data; sample content is enabled only by a test launch argument and never preloaded into a normal installation.
