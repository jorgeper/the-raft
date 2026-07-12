// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "gargoyle-spike",
    platforms: [.macOS(.v14)],
    targets: [
        // Apple's libpcap plus a hand-declared pktap header layout —
        // net/pktap.h is not in the public SDK, but the wire format is
        // stable in xnu (bsd/net/pktap.h).
        .systemLibrary(name: "CPcap", path: "Sources/CPcap"),
        .target(name: "SpikeCore", dependencies: ["CPcap"]),
        .executableTarget(name: "gargoyle-spike", dependencies: ["SpikeCore", "CPcap"]),
        // Self-checking test executable: the Command Line Tools toolchain on
        // this machine ships neither XCTest nor Swift Testing. Run with
        // `swift run spike-tests`; migrate to a real test framework in Phase 1
        // (which needs full Xcode anyway).
        .executableTarget(name: "spike-tests", dependencies: ["SpikeCore", "CPcap"]),
    ]
)
