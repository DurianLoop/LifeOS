// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LifeOSCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "LifeOSCore", targets: ["LifeOSCore"])],
    targets: [
        .target(name: "LifeOSCore", path: "Core", linkerSettings: [.linkedLibrary("sqlite3"), .linkedLibrary("z")]),
        .testTarget(name: "LifeOSCoreTests", dependencies: ["LifeOSCore"], path: "Tests")
    ]
)
