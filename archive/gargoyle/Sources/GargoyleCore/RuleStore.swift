import Foundation
import GRDB

/// Persistence for rules, profiles and per-app modes (spec §5 "Rule profiles").
/// Rules belong to a named profile; exactly one profile is active at a time.
public final class RuleStore: @unchecked Sendable {
    private let writer: any DatabaseWriter

    public init(store: AuditStore) throws {
        writer = store.writerForTesting
        try Self.migrator.migrate(writer)
        try ensureDefaultProfile()
    }

    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("rules_v1") { db in
            try db.create(table: "profiles") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("name", .text).notNull().unique()
                t.column("isActive", .boolean).notNull().defaults(to: false)
            }
            try db.create(table: "rules") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("profileID", .integer).notNull().indexed().references("profiles", onDelete: .cascade)
                t.column("payload", .text).notNull()      // JSON-encoded Rule
                t.column("hitCount", .integer).notNull().defaults(to: 0)
                t.column("createdAtMs", .integer).notNull()
            }
            try db.create(table: "app_modes") { t in
                t.column("appKey", .text).primaryKey()    // JSON-encoded AppKey
                t.column("mode", .text).notNull()
            }
            try db.create(table: "verdict_events") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("flowSeq", .integer).indexed()
                t.column("atMs", .integer).notNull()
                t.column("action", .text).notNull()
                t.column("source", .text).notNull()
                t.column("matchedRuleID", .integer)
                t.column("wouldHaveBlocked", .boolean).notNull().defaults(to: false)
                t.column("trace", .text).notNull()        // JSON array of strings
            }
        }
        return migrator
    }

    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    // MARK: - Profiles

    @discardableResult
    private func ensureDefaultProfile() throws -> Int64 {
        try writer.write { db in
            if let id = try Int64.fetchOne(db, sql: "SELECT id FROM profiles WHERE isActive = 1") {
                return id
            }
            if let id = try Int64.fetchOne(db, sql: "SELECT id FROM profiles ORDER BY id LIMIT 1") {
                try db.execute(sql: "UPDATE profiles SET isActive = 1 WHERE id = ?", arguments: [id])
                return id
            }
            try db.execute(sql: "INSERT INTO profiles (name, isActive) VALUES ('Normal', 1)")
            return db.lastInsertedRowID
        }
    }

    public func profiles() throws -> [Profile] {
        try writer.read { db in
            try Row.fetchAll(db, sql: "SELECT id, name, isActive FROM profiles ORDER BY id").map {
                Profile(id: $0["id"], name: $0["name"], isActive: $0["isActive"])
            }
        }
    }

    public func activeProfile() throws -> Profile {
        try writer.read { db in
            let row = try Row.fetchOne(db, sql: "SELECT id, name, isActive FROM profiles WHERE isActive = 1")!
            return Profile(id: row["id"], name: row["name"], isActive: true)
        }
    }

    @discardableResult
    public func createProfile(name: String) throws -> Int64 {
        try writer.write { db in
            try db.execute(sql: "INSERT INTO profiles (name, isActive) VALUES (?, 0)", arguments: [name])
            return db.lastInsertedRowID
        }
    }

    /// Exactly one profile is active; switching rebuilds the engine's rule set.
    public func activateProfile(id: Int64) throws {
        try writer.write { db in
            try db.execute(sql: "UPDATE profiles SET isActive = 0")
            try db.execute(sql: "UPDATE profiles SET isActive = 1 WHERE id = ?", arguments: [id])
        }
    }

    // MARK: - Rules

    public func rules(profileID: Int64) throws -> [Rule] {
        try writer.read { db in
            try Row.fetchAll(db, sql: "SELECT id, payload FROM rules WHERE profileID = ? ORDER BY id",
                             arguments: [profileID])
                .compactMap { row in
                    guard let text: String = row["payload"],
                          var rule = try? Self.decoder.decode(Rule.self, from: Data(text.utf8))
                    else { return nil }
                    rule.id = row["id"]      // the row id is authoritative
                    return rule
                }
        }
    }

    public func activeRules() throws -> [Rule] {
        try rules(profileID: try activeProfile().id)
    }

    @discardableResult
    public func addRule(_ rule: Rule) throws -> Int64 {
        let payload = String(decoding: try Self.encoder.encode(rule), as: UTF8.self)
        return try writer.write { db in
            try db.execute(sql: """
                INSERT INTO rules (profileID, payload, hitCount, createdAtMs) VALUES (?, ?, 0, ?)
                """, arguments: [rule.profileID, payload, Int64(Date().timeIntervalSince1970 * 1000)])
            return db.lastInsertedRowID
        }
    }

    public func deleteRule(id: Int64) throws {
        _ = try writer.write { db in
            try db.execute(sql: "DELETE FROM rules WHERE id = ?", arguments: [id])
        }
    }

    public func recordHits(_ hits: [Int64: Int]) throws {
        guard !hits.isEmpty else { return }
        try writer.write { db in
            for (id, count) in hits {
                try db.execute(sql: "UPDATE rules SET hitCount = hitCount + ? WHERE id = ?",
                               arguments: [count, id])
            }
        }
    }

    public func hitCount(id: Int64) throws -> Int {
        try writer.read { db in
            try Int.fetchOne(db, sql: "SELECT hitCount FROM rules WHERE id = ?", arguments: [id]) ?? 0
        }
    }

    // MARK: - Per-app modes

    public func setMode(_ mode: AppMode, for app: AppKey) throws {
        let key = String(decoding: try Self.encoder.encode(app), as: UTF8.self)
        try writer.write { db in
            try db.execute(sql: """
                INSERT INTO app_modes (appKey, mode) VALUES (?, ?)
                ON CONFLICT(appKey) DO UPDATE SET mode = excluded.mode
                """, arguments: [key, mode.rawValue])
        }
    }

    public func modes() throws -> [AppKey: AppMode] {
        try writer.read { db in
            var result: [AppKey: AppMode] = [:]
            for row in try Row.fetchAll(db, sql: "SELECT appKey, mode FROM app_modes") {
                guard let keyText: String = row["appKey"],
                      let key = try? Self.decoder.decode(AppKey.self, from: Data(keyText.utf8)),
                      let modeText: String = row["mode"],
                      let mode = AppMode(rawValue: modeText) else { continue }
                result[key] = mode
            }
            return result
        }
    }

    // MARK: - Verdict events

    public func recordVerdict(flowSeq: Int64?, decision: Decision, wouldHaveBlocked: Bool,
                              at now: Date = Date()) throws {
        let trace = String(decoding: try Self.encoder.encode(decision.trace), as: UTF8.self)
        try writer.write { db in
            try db.execute(sql: """
                INSERT INTO verdict_events (flowSeq, atMs, action, source, matchedRuleID, wouldHaveBlocked, trace)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, arguments: [flowSeq, Int64(now.timeIntervalSince1970 * 1000),
                                 decision.action.rawValue, decision.source.rawValue,
                                 decision.matchedRuleID, wouldHaveBlocked, trace])
        }
    }

    public func verdictEvents(limit: Int = 100) throws -> [VerdictEvent] {
        try writer.read { db in
            try Row.fetchAll(db, sql: """
                SELECT id, flowSeq, atMs, action, source, matchedRuleID, wouldHaveBlocked, trace
                FROM verdict_events ORDER BY id DESC LIMIT ?
                """, arguments: [limit]).map { row in
                let traceText: String = row["trace"]
                let trace = (try? Self.decoder.decode([String].self, from: Data(traceText.utf8))) ?? []
                return VerdictEvent(
                    id: row["id"], flowSeq: row["flowSeq"],
                    at: Date(timeIntervalSince1970: Double(row["atMs"] as Int64) / 1000),
                    action: row["action"], source: row["source"],
                    matchedRuleID: row["matchedRuleID"],
                    wouldHaveBlocked: row["wouldHaveBlocked"], trace: trace)
            }
        }
    }

    // MARK: - Export / import (spec §5: profiles are portable JSON)

    public func exportProfile(id: Int64) throws -> Data {
        let profile = try profiles().first { $0.id == id }
        let bundle = ProfileBundle(name: profile?.name ?? "Profile",
                                   rules: try rules(profileID: id))
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(bundle)
    }

    /// Imports a bundle as a new profile (name suffixed if it collides).
    @discardableResult
    public func importProfile(_ data: Data) throws -> Int64 {
        let bundle = try Self.decoder.decode(ProfileBundle.self, from: data)
        var name = bundle.name
        let existing = Set(try profiles().map(\.name))
        var suffix = 2
        while existing.contains(name) {
            name = "\(bundle.name) \(suffix)"
            suffix += 1
        }
        let profileID = try createProfile(name: name)
        for var rule in bundle.rules {
            rule.profileID = profileID
            try addRule(rule)
        }
        return profileID
    }
}

public struct Profile: Identifiable, Hashable, Sendable {
    public var id: Int64
    public var name: String
    public var isActive: Bool
}

public struct ProfileBundle: Codable, Sendable {
    public var name: String
    public var rules: [Rule]
}

public struct VerdictEvent: Identifiable, Sendable {
    public var id: Int64
    public var flowSeq: Int64?
    public var at: Date
    public var action: String
    public var source: String
    public var matchedRuleID: Int64?
    public var wouldHaveBlocked: Bool
    public var trace: [String]
}
