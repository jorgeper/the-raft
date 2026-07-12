import Foundation
import CryptoKit
import GRDB

/// Durable audit log (spec §6): SQLite via GRDB, WAL, append-only hash-chained
/// `flows` rows for tamper evidence, 30-day detail retention with indefinite
/// per-app/day aggregates.
///
/// Chain semantics: each row stores `prevHash` (the previous row's `hash`, or
/// "genesis" for the first) and `hash` = SHA256(prevHash + "|" + canonical
/// fields). Verification recomputes every retained row and checks continuity;
/// retention trims whole prefixes of the chain, so the earliest retained row's
/// stored `prevHash` serves as its anchor. Edits and mid-chain deletions are
/// detectable; trimming the head (what retention legitimately does) is not.
public final class AuditStore: @unchecked Sendable {
    private let writer: any DatabaseWriter

    /// Exposed so tests can simulate tampering with raw SQL.
    public var writerForTesting: any DatabaseWriter { writer }

    public static func defaultDatabasePath() throws -> String {
        let dir = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Gargoyle", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("audit.sqlite").path
    }

    public convenience init(path: String) throws {
        // DatabasePool = WAL mode, concurrent readers.
        try self.init(writer: DatabasePool(path: path))
    }

    public static func inMemory() throws -> AuditStore {
        try AuditStore(writer: DatabaseQueue())
    }

    private init(writer: any DatabaseWriter) throws {
        self.writer = writer
        try Self.migrator.migrate(writer)
    }

    private static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.create(table: "app_identities") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("signingID", .text)
                t.column("teamID", .text)
                t.column("path", .text)
                t.column("displayName", .text).notNull()
                t.column("isSystem", .boolean).notNull().defaults(to: false)
                t.column("firstSeenMs", .integer).notNull()
                t.uniqueKey(["signingID", "teamID", "path"])
            }
            try db.create(table: "flows") { t in
                t.autoIncrementedPrimaryKey("seq")
                t.column("openedAtMs", .integer).notNull()
                t.column("closedAtMs", .integer).notNull().indexed()
                t.column("appIdentityID", .integer).references("app_identities")
                t.column("pid", .integer).notNull()
                t.column("comm", .text).notNull()
                t.column("processLabel", .text).notNull().indexed()
                t.column("host", .text)
                t.column("proto", .integer).notNull()
                t.column("src", .text).notNull()
                t.column("sport", .integer).notNull()
                t.column("dst", .text).notNull().indexed()
                t.column("dport", .integer).notNull()
                t.column("ifname", .text).notNull()
                t.column("bytesOut", .integer).notNull()
                t.column("bytesIn", .integer).notNull()
                t.column("verdict", .text).notNull()
                t.column("tap", .text).notNull()
                t.column("prevHash", .text).notNull()
                t.column("hash", .text).notNull()
            }
            // Size-capped unencrypted payload captures (spec §2.3); populated
            // in a later phase, schema reserved here.
            try db.create(table: "payloads") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("flowSeq", .integer).notNull().indexed().references("flows")
                t.column("direction", .text).notNull()
                t.column("capturedAtMs", .integer).notNull()
                t.column("bytes", .blob).notNull()
                t.column("truncated", .boolean).notNull()
            }
            // Indefinite per-app/day rollups that survive detail retention.
            try db.create(table: "app_day_aggregates") { t in
                t.column("appLabel", .text).notNull()
                t.column("day", .text).notNull()
                t.column("flowCount", .integer).notNull()
                t.column("bytesOut", .integer).notNull()
                t.column("bytesIn", .integer).notNull()
                t.primaryKey(["appLabel", "day"])
            }
        }
        return migrator
    }

    // MARK: - Append

    private static let genesisHash = "genesis"

    @discardableResult
    public func appendFlow(_ draft: FlowDraft) throws -> FlowAuditRecord {
        try writer.write { db in
            let prevHash = try String.fetchOne(
                db, sql: "SELECT hash FROM flows ORDER BY seq DESC LIMIT 1") ?? Self.genesisHash

            var record = FlowAuditRecord(
                seq: nil,
                openedAtMs: Int64(draft.openedAt.timeIntervalSince1970 * 1000),
                closedAtMs: Int64(draft.closedAt.timeIntervalSince1970 * 1000),
                appIdentityID: draft.appIdentityID,
                pid: draft.pid, comm: draft.comm, processLabel: draft.processLabel,
                host: draft.host, proto: Int(draft.proto),
                src: draft.src, sport: Int(draft.sport),
                dst: draft.dst, dport: Int(draft.dport), ifname: draft.ifname,
                bytesOut: draft.bytesOut, bytesIn: draft.bytesIn,
                verdict: draft.verdict.rawValue, tap: draft.tap.rawValue,
                prevHash: prevHash, hash: "")
            record.hash = Self.chainHash(prevHash: prevHash, canonical: record.canonicalString)
            try record.insert(db)

            let day = Self.dayString(ms: record.closedAtMs)
            try db.execute(sql: """
                INSERT INTO app_day_aggregates (appLabel, day, flowCount, bytesOut, bytesIn)
                VALUES (?, ?, 1, ?, ?)
                ON CONFLICT(appLabel, day) DO UPDATE SET
                    flowCount = flowCount + 1,
                    bytesOut = bytesOut + excluded.bytesOut,
                    bytesIn = bytesIn + excluded.bytesIn
                """, arguments: [record.processLabel, day, record.bytesOut, record.bytesIn])
            return record
        }
    }

    static func chainHash(prevHash: String, canonical: String) -> String {
        let digest = SHA256.hash(data: Data((prevHash + "|" + canonical).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func dayString(ms: Int64) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let date = Date(timeIntervalSince1970: Double(ms) / 1000)
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    // MARK: - Verification

    public func verifyChain() throws -> ChainVerification {
        try writer.read { db in
            var expectedPrev: String? = nil  // unknown until the first retained row
            var count = 0
            let cursor = try FlowAuditRecord.fetchCursor(
                db, sql: "SELECT * FROM flows ORDER BY seq ASC")
            while let row = try cursor.next() {
                if let expectedPrev, row.prevHash != expectedPrev {
                    return .broken(atSeq: row.seq!)
                }
                let recomputed = Self.chainHash(prevHash: row.prevHash, canonical: row.canonicalString)
                if recomputed != row.hash {
                    return .broken(atSeq: row.seq!)
                }
                expectedPrev = row.hash
                count += 1
            }
            return .valid(rowCount: count)
        }
    }

    // MARK: - Identities

    @discardableResult
    public func upsertIdentity(signingID: String?, teamID: String?, path: String?,
                               displayName: String, isSystem: Bool = false) throws -> Int64 {
        try writer.write { db in
            if let existing = try Int64.fetchOne(db, sql: """
                SELECT id FROM app_identities
                WHERE signingID IS ? AND teamID IS ? AND path IS ?
                """, arguments: [signingID, teamID, path]) {
                return existing
            }
            var record = AppIdentityRecord(
                id: nil, signingID: signingID, teamID: teamID, path: path,
                displayName: displayName, isSystem: isSystem,
                firstSeenMs: Int64(Date().timeIntervalSince1970 * 1000))
            try record.insert(db)
            return record.id!
        }
    }

    // MARK: - Queries

    public func recentFlows(limit: Int) throws -> [FlowAuditRecord] {
        try writer.read { db in
            try FlowAuditRecord.fetchAll(
                db, sql: "SELECT * FROM flows ORDER BY seq DESC LIMIT ?", arguments: [limit])
        }
    }

    public func dayAggregates() throws -> [DayAggregate] {
        try writer.read { db in
            try DayAggregate.fetchAll(
                db, sql: "SELECT * FROM app_day_aggregates ORDER BY day, appLabel")
        }
    }

    /// Digest for learning mode / review: destinations grouped per app in a window.
    public func appDestinationSummary(since: Date) throws -> [(processLabel: String, host: String, flowCount: Int, bytes: Int)] {
        try writer.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT processLabel, COALESCE(host, dst) AS destination,
                       COUNT(*) AS flowCount, SUM(bytesOut + bytesIn) AS bytes
                FROM flows WHERE openedAtMs >= ?
                GROUP BY processLabel, destination
                ORDER BY processLabel, bytes DESC
                """, arguments: [Int64(since.timeIntervalSince1970 * 1000)])
            return rows.map { ($0["processLabel"], $0["destination"], $0["flowCount"], $0["bytes"]) }
        }
    }

    // MARK: - Retention

    /// Deletes flow detail older than `detailDays`; aggregates persist.
    public func applyRetention(detailDays: Int, now: Date = Date()) throws {
        let cutoffMs = Int64((now.timeIntervalSince1970 - Double(detailDays) * 86400) * 1000)
        _ = try writer.write { db in
            try db.execute(sql: "DELETE FROM payloads WHERE flowSeq IN (SELECT seq FROM flows WHERE closedAtMs < ?)",
                           arguments: [cutoffMs])
            try db.execute(sql: "DELETE FROM flows WHERE closedAtMs < ?", arguments: [cutoffMs])
        }
    }
}
