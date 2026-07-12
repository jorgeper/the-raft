import Foundation
import GargoyleCore
import CaptureKit

/// Synthetic traffic for GARGOYLE_MOCK_TAP=1: exercises the full UI without
/// root or the helper daemon.
enum MockScript {
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

        return [
            (0.3, .event(.hello(version: TapWire.version, tap: "pcap"))),
            (0.2, .event(new(1, 843, "Safari", "151.101.1.6", 443, "cdn.sstatic.net"))),
            (0.5, .event(stat(1, 1200, 48_000))),
            (0.6, .event(new(2, 1204, "node", "140.82.113.4", 443, "api.github.com"))),
            (0.5, .event(stat(2, 900, 3_200))),
            (0.7, .event(stat(1, 400, 120_000))),
            (0.6, .event(new(3, 512, "nsurlsessiond", "17.253.5.204", 443, "gs.apple.com"))),
            (0.5, .event(stat(3, 300, 800))),
            (0.8, .event(stat(2, 12_000, 1_500))),
            (0.7, .event(stat(1, 250, 60_000))),
            (0.9, .event(new(4, 2523, "Slack", "3.4.5.6", 443, "wss.slack.com"))),
            (0.5, .event(stat(4, 4_500, 9_000))),
            (0.8, .event(close(1, 1850, 228_000))),
            (0.7, .event(stat(4, 2_000, 5_000))),
            (0.9, .event(close(2, 12_900, 4_700))),
            (0.8, .event(close(3, 300, 800))),
            (1.2, .event(close(4, 6_500, 14_000))),
        ]
    }
}
