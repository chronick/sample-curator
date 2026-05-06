// swift-tools-version:6.0
// Apple Foundation Models bridge for sample-curator (vault-3ume).
//
// Linked from Rust via `swift-rs` (see ../../Cargo.toml + ../../build.rs).
// All entry points are `@_cdecl` C-callable functions returning `SRString`
// or primitive types so the Rust side can wrap them in safe types.

import PackageDescription

let package = Package(
    name: "sample-curator-fm",
    platforms: [
        // Foundation Models is available on macOS 15.1+ via Apple Intelligence.
        // We gate at runtime via `#available` checks; the deployment target
        // here just needs to be high enough to compile against the framework.
        .macOS(.v15)
    ],
    products: [
        .library(
            name: "SampleCuratorFM",
            type: .static,
            targets: ["SampleCuratorFM"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/Brendonovich/swift-rs", from: "1.0.6"),
    ],
    targets: [
        .target(
            name: "SampleCuratorFM",
            dependencies: [
                .product(name: "SwiftRs", package: "swift-rs"),
            ],
            path: "Sources/SampleCuratorFM"
        ),
    ]
)
