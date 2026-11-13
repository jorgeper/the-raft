import Foundation

/// Wire event streamed from a tap (privileged helper or, later, the filter
/// extension) to the app: newline-delimited JSON, one event per line.
public struct TapEvent: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case hello   // first event on connect: version + tap kind
        case new     // flow opened
        case stat    // byte-count deltas for an active flow
        case close   // flow ended (idle timeout or teardown); carries totals
    }

    public var kind: Kind
    public var ts: Double?

    // hello
    public var version: Int?
    public var tap: String?

    // flow identity (new/stat/close)
    public var id: UInt64?

    // new
    public var pid: Int32?
    public var comm: String?
    public var epid: Int32?
    public var ecomm: String?
    public var proto: UInt8?
    public var src: String?
    public var sport: UInt16?
    public var dst: String?
    public var dport: UInt16?
    public var host: String?
    public var ifname: String?

    // stat: deltas since last stat; close: final totals
    public var bytesOut: Int?
    public var bytesIn: Int?

    public init(kind: Kind) {
        self.kind = kind
    }

    public static func hello(version: Int, tap: String) -> TapEvent {
        var e = TapEvent(kind: .hello)
        e.version = version
        e.tap = tap
        return e
    }
}

public enum TapWire {
    public static let version = 1

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }()
    private static let decoder = JSONDecoder()

    /// One JSON line, newline-terminated.
    public static func encodeLine(_ event: TapEvent) throws -> Data {
        var data = try encoder.encode(event)
        data.append(0x0A)
        return data
    }

    public static func decode(line: Data) throws -> TapEvent {
        try decoder.decode(TapEvent.self, from: line)
    }
}
