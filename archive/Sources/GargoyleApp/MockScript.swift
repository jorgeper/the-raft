import Foundation
import GargoyleCore
import CaptureKit

/// Synthetic traffic for GARGOYLE_MOCK_TAP=1: exercises the full UI without
/// root or the helper daemon.
enum MockScript {
    /// Identities matching the demo script's process names.
    static let resolver: @Sendable (Int32, String) -> ResolvedIdentity = { _, comm in
        if comm == "nsurlsessiond" {
            return ResolvedIdentity(signingID: "com.apple.nsurlsessiond", teamID: nil,
                                    path: "/usr/libexec/nsurlsessiond",
                                    displayName: "nsurlsessiond", isSystem: true)
        }
        return ResolvedIdentity(signingID: "com.example.\(comm)", teamID: "TEAM42",
                                path: "/Applications/\(comm).app",
                                displayName: comm, isSystem: false)
    }

    static var demoLoop: [(delay: TimeInterval, event: TapConnectionEvent)] {
        func new(_ id: UInt64, _ pid: Int32, _ comm: String, _ dst: String,
                 _ dport: UInt16, _ host: String?) -> TapEvent {
            var e = TapEvent(kind: .new)
            e.ts = Date().timeIntervalSince1970
            e.id = id; e.pid = pid; e.comm = comm
            e.proto = 6; e.src = "192.168.1.20"; e.sport = UInt16(49000 + id)
            e.dst = dst; e.dport = dport; e.host = host; e.ifname = "en0"
            return e
        }
        func stat(_ id: UInt64, _ out: Int, _ inn: Int) -> TapEvent {
            var e = TapEvent(kind: .stat)
            e.ts = Date().timeIntervalSince1970
            e.id = id; e.bytesOut = out; e.bytesIn = inn
            return e
        }
        func close(_ id: UInt64, _ out: Int, _ inn: Int) -> TapEvent {
            var e = TapEvent(kind: .close)
            e.ts = Date().timeIntervalSince1970
            e.id = id; e.bytesOut = out; e.bytesIn = inn
            return e
        }

        // One flow per destination category, so the constellation exercises
        // every ring: CDN, dev tooling, ads, telemetry, and unknown.
        return [
            (0.3, .event(.hello(version: TapWire.version, tap: "pcap"))),
            (0.2, .event(new(1, 843, "Safari", "151.101.1.6", 443, "cdn.sstatic.net"))),
            (0.4, .event(stat(1, 1200, 48_000))),
            (0.3, .event(new(5, 843, "Safari", "142.250.1.1", 443, "ads.doubleclick.net"))),
            (0.3, .event(stat(5, 800, 2_400))),
            (0.4, .event(new(6, 843, "Safari", "35.1.2.3", 443, "cdn.sentry.io"))),
            (0.3, .event(stat(6, 2_300, 400))),
            (0.4, .event(new(7, 843, "Safari", "203.0.113.9", 443, "odd-tracker.xyz"))),
            (0.3, .event(stat(7, 500, 120))),
            (0.5, .event(new(2, 1204, "node", "140.82.113.4", 443, "api.github.com"))),
            (0.4, .event(stat(2, 900, 3_200))),
            (0.4, .event(new(8, 1204, "node", "104.16.11.34", 443, "registry.npmjs.org"))),
            (0.3, .event(stat(8, 400, 88_000))),
            (0.5, .event(stat(1, 400, 120_000))),
            (0.4, .event(new(3, 512, "nsurlsessiond", "17.253.5.204", 443, "gs.apple.com"))),
            (0.3, .event(stat(3, 300, 800))),
            (0.5, .event(stat(2, 12_000, 1_500))),
            (0.5, .event(new(4, 2523, "Slack", "3.4.5.6", 443, "wss.slack.com"))),
            (0.4, .event(stat(4, 4_500, 9_000))),
            (0.5, .event(close(1, 1850, 228_000))),
            (0.3, .event(close(5, 800, 2_400))),
            (0.3, .event(close(6, 2_300, 400))),
            (0.3, .event(close(7, 500, 120))),
            (0.4, .event(close(8, 400, 88_000))),
            (0.5, .event(close(2, 12_900, 4_700))),
            (0.4, .event(close(3, 300, 800))),
            (0.6, .event(stat(4, 2_000, 5_000))),
            (0.8, .event(close(4, 6_500, 14_000))),
        ]
    }
}
