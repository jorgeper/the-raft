// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "gargoyle",
    platforms: [.macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        // Apple's libpcap plus hand-declared pktap/libproc shims —
        // net/pktap.h is not in the public SDK, but the wire format is
        // stable in xnu (bsd/net/pktap.h).
        .systemLibrary(name: "CPcap", path: "Sources/CPcap"),

        // Packet capture and flow assembly: pktap parsing, IP/transport
        // parsing, flow aggregation, DNS correlation, tap wire protocol.
        // Shared by the privileged helper and the app.
        .target(name: "CaptureKit", dependencies: ["CPcap"]),

        // App-side domain: FlowTap protocol + PcapTap client, flow pipeline,
        // hash-chained audit store, app identity resolution.
        .target(name: "GargoyleCore", dependencies: [
            "CaptureKit", "CPcap",
            .product(name: "GRDB", package: "GRDB.swift"),
        ]),

        // Privileged capture daemon (runs as root via launchd; streams
        // flow events to the app over a uid-restricted unix socket).
        .executableTarget(name: "gargoyle-helperd", dependencies: ["CaptureKit", "CPcap"]),

        // Menu-bar app.
        .executableTarget(name: "GargoyleApp", dependencies: ["GargoyleCore", "CaptureKit"]),

        // Phase 0 spike CLI, kept for ad-hoc capture debugging.
        .executableTarget(name: "gargoyle-spike", dependencies: ["CaptureKit", "CPcap"]),

        .testTarget(name: "CaptureKitTests", dependencies: ["CaptureKit", "CPcap"]),
        .testTarget(name: "GargoyleCoreTests", dependencies: ["GargoyleCore", "CaptureKit"]),
    ]
)
