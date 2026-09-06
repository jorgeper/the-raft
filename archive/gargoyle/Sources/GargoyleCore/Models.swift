import Foundation
import GRDB

public enum Verdict: String, Codable, Sendable {
    case monitored   // Monitor mode: allowed, logged, alert-eligible
    case allowed     // Phase 2: explicit rule allow
    case blocked     // Phase 2: firewall block
}

public enum TapKind: String, Codable, Sendable {
    case pcap        // Tap B: pktap via privileged helper (monitor-only)
    case filter      // Tap A: NEFilterDataProvider system extension
}

/// A finalized flow ready to be appended to the audit chain.
public struct FlowDraft: Sendable {
    public var openedAt: Date
    public var closedAt: Date
    public var appIdentityID: Int64?
    public var pid: Int32
    public var comm: String
    public var processLabel: String
    public var host: String?
    public var proto: UInt8
    public var src: String
    public var sport: UInt16
    public var dst: String
    public var dport: UInt16
    public var ifname: String
    public var bytesOut: Int
    public var bytesIn: Int
    public var verdict: Verdict
    public var tap: TapKind

    public init(openedAt: Date, closedAt: Date, appIdentityID: Int64?, pid: Int32,
                comm: String, processLabel: String, host: String?, proto: UInt8,
                src: String, sport: UInt16, dst: String, dport: UInt16, ifname: String,
                bytesOut: Int, bytesIn: Int, verdict: Verdict, tap: TapKind) {
        self.openedAt = openedAt
        self.closedAt = closedAt
        self.appIdentityID = appIdentityID
        self.pid = pid
        self.comm = comm
        self.processLabel = processLabel
        self.host = host
        self.proto = proto
        self.src = src
        self.sport = sport
        self.dst = dst
        self.dport = dport
        self.ifname = ifname
        self.bytesOut = bytesOut
        self.bytesIn = bytesIn
        self.verdict = verdict
        self.tap = tap
    }
}

/// A row in the hash-chained `flows` table.
public struct FlowAuditRecord: Codable, FetchableRecord, MutablePersistableRecord, Sendable {
    public static let databaseTableName = "flows"

    public var seq: Int64?
    public var openedAtMs: Int64
    public var closedAtMs: Int64
    public var appIdentityID: Int64?
    public var pid: Int32
    public var comm: String
    public var processLabel: String
    public var host: String?
    public var proto: Int
    public var src: String
    public var sport: Int
    public var dst: String
    public var dport: Int
    public var ifname: String
    public var bytesOut: Int
    public var bytesIn: Int
    public var verdict: String
    public var tap: String
    public var prevHash: String
    public var hash: String

    public var openedAt: Date { Date(timeIntervalSince1970: Double(openedAtMs) / 1000) }
    public var closedAt: Date { Date(timeIntervalSince1970: Double(closedAtMs) / 1000) }

    /// Stable serialization hashed into the chain. Timestamps as integer ms so
    /// no formatter can perturb the digest.
    var canonicalString: String {
        [String(openedAtMs), String(closedAtMs), appIdentityID.map(String.init) ?? "-",
         String(pid), comm, processLabel, host ?? "-", String(proto),
         src, String(sport), dst, String(dport), ifname,
         String(bytesOut), String(bytesIn), verdict, tap].joined(separator: "|")
    }

    public mutating func didInsert(_ inserted: InsertionSuccess) {
        seq = inserted.rowID
    }
}

public struct AppIdentityRecord: Codable, FetchableRecord, MutablePersistableRecord, Sendable {
    public static let databaseTableName = "app_identities"

    public var id: Int64?
    public var signingID: String?
    public var teamID: String?
    public var path: String?
    public var displayName: String
    public var isSystem: Bool
    public var firstSeenMs: Int64

    public mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

public struct DayAggregate: Codable, FetchableRecord, Sendable {
    public var appLabel: String
    public var day: String
    public var flowCount: Int
    public var bytesOut: Int
    public var bytesIn: Int
}

public enum ChainVerification: Equatable, Sendable {
    case valid(rowCount: Int)
    case broken(atSeq: Int64)
}
