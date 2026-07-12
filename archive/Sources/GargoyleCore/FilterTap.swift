import Foundation
import CaptureKit

/// Tap A client (spec §2.1): the app side of the NEFilterDataProvider system
/// extension. Same `FlowTap` surface as PcapTap, plus the ability to answer a
/// held flow — the capability that makes real blocking possible.
///
/// STATUS: the wire/verdict contract and its fail-closed policy are complete
/// and tested (see FilterVerdictPolicy). The live transport is not wired up,
/// because the extension can only run from a signed .app bundle with the
/// `com.apple.developer.networking.networkextension` (content-filter)
/// entitlement, which needs an Apple Developer account and a user approval in
/// System Settings. Until that bundle exists, `FilterTap.isAvailable` is false
/// and the app runs on Tap B, exactly as the spec's degrade path requires.
public final class FilterTap: FlowTap, @unchecked Sendable {
    public let kind = TapKind.filter

    /// True once the system extension is activated and reachable. Always false
    /// today: see the note above.
    public static var isAvailable: Bool { false }

    public init() {}

    public func events() -> AsyncStream<TapConnectionEvent> {
        AsyncStream { continuation in
            // No extension to connect to yet: report unavailability rather than
            // pretending to monitor.
            continuation.yield(.disconnected)
            continuation.finish()
        }
    }

    /// Answers a held flow. The extension applies the verdict to the live
    /// connection (allow or drop before any data moves).
    public func answer(flowID: UInt64, verdict: FilterVerdict) {
        // Delivered over the extension's XPC channel once the bundle exists.
    }

    public func stop() {}
}

/// Chooses the tap at startup (spec §3): prefer the content filter when it can
/// actually be activated, otherwise degrade to monitor-only pcap and say so.
public enum TapSelector {
    public struct Selection: Sendable {
        public let tap: any FlowTap
        public let monitorOnly: Bool
        public let reason: String
    }

    public static func select() -> Selection {
        if FilterTap.isAvailable {
            return Selection(tap: FilterTap(), monitorOnly: false,
                             reason: "content filter active — blocking available")
        }
        return Selection(tap: PcapTap(), monitorOnly: true,
                         reason: "monitor-only: content-filter extension not installed")
    }
}
