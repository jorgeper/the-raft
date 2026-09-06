import Foundation
import GRDB

/// One destination node in an app's constellation (spec §7.2).
public struct DestinationNode: Identifiable, Sendable, Equatable {
    public var id: String { destination }
    public var destination: String        // hostname when known, else IP
    public var ip: String
    public var port: Int
    public var service: String
    public var category: DestinationCategory
    public var bytesOut: Int
    public var bytesIn: Int
    public var flowCount: Int
    public var firstSeen: Date
    public var lastSeen: Date
    public var everBlocked: Bool          // includes would-have-blocked
    public var everAlerted: Bool

    public var totalBytes: Int { bytesOut + bytesIn }
}

public struct AppRollup: Identifiable, Sendable {
    public var id: String { processLabel }
    public var processLabel: String
    public var displayName: String
    public var flowCount: Int
    public var bytesOut: Int
    public var bytesIn: Int
    public var destinationCount: Int
    public var lastSeen: Date
    public var totalBytes: Int { bytesOut + bytesIn }
}

/// Anomaly badges (spec §7.3).
public enum Anomaly: Equatable, Sendable {
    case firstEverDestination(String)
    case volumeSpike(multiple: Double)

    public var label: String {
        switch self {
        case .firstEverDestination(let host): return "first-ever destination: \(host)"
        case .volumeSpike(let multiple): return String(format: "%.0f× normal volume", multiple)
        }
    }
}

extension AuditStore {
    /// Destination graph for one app over a window — the constellation's nodes.
    public func destinationNodes(processLabel: String, since: Date, until: Date = Date(),
                                 heuristics: HeuristicsDB = HeuristicsDB()) throws -> [DestinationNode] {
        let rows = try writerForTesting.read { db in
            try Row.fetchAll(db, sql: """
                SELECT COALESCE(host, dst) AS destination, dst AS ip, dport,
                       SUM(bytesOut) AS bytesOut, SUM(bytesIn) AS bytesIn,
                       COUNT(*) AS flowCount,
                       MIN(openedAtMs) AS firstSeenMs, MAX(closedAtMs) AS lastSeenMs,
                       MAX(verdict = 'blocked') AS everBlocked,
                       MAX(verdict = 'monitored') AS everAlerted
                FROM flows
                WHERE processLabel = ? AND closedAtMs >= ? AND closedAtMs <= ?
                GROUP BY destination, dport
                ORDER BY (SUM(bytesOut) + SUM(bytesIn)) DESC
                """, arguments: [processLabel,
                                 Int64(since.timeIntervalSince1970 * 1000),
                                 Int64(until.timeIntervalSince1970 * 1000)])
        }
        return rows.map { row in
            let destination: String = row["destination"]
            let ip: String = row["ip"]
            let host = destination == ip ? nil : destination
            let classification = heuristics.classify(host: host, ip: ip)
            return DestinationNode(
                destination: destination, ip: ip, port: row["dport"],
                service: classification.service, category: classification.category,
                bytesOut: row["bytesOut"], bytesIn: row["bytesIn"],
                flowCount: row["flowCount"],
                firstSeen: Date(timeIntervalSince1970: Double(row["firstSeenMs"] as Int64) / 1000),
                lastSeen: Date(timeIntervalSince1970: Double(row["lastSeenMs"] as Int64) / 1000),
                everBlocked: (row["everBlocked"] as Int?) == 1,
                everAlerted: (row["everAlerted"] as Int?) == 1)
        }
    }

    /// Apps seen in a window, biggest talkers first.
    public func appRollups(since: Date, until: Date = Date()) throws -> [AppRollup] {
        try writerForTesting.read { db in
            try Row.fetchAll(db, sql: """
                SELECT f.processLabel AS processLabel,
                       COALESCE(i.displayName, f.comm) AS displayName,
                       COUNT(*) AS flowCount,
                       SUM(f.bytesOut) AS bytesOut, SUM(f.bytesIn) AS bytesIn,
                       COUNT(DISTINCT COALESCE(f.host, f.dst)) AS destinationCount,
                       MAX(f.closedAtMs) AS lastSeenMs
                FROM flows f
                LEFT JOIN app_identities i ON i.id = f.appIdentityID
                WHERE f.closedAtMs >= ? AND f.closedAtMs <= ?
                GROUP BY f.processLabel
                ORDER BY (SUM(f.bytesOut) + SUM(f.bytesIn)) DESC
                """, arguments: [Int64(since.timeIntervalSince1970 * 1000),
                                 Int64(until.timeIntervalSince1970 * 1000)])
                .map { row in
                    AppRollup(processLabel: row["processLabel"], displayName: row["displayName"],
                              flowCount: row["flowCount"],
                              bytesOut: row["bytesOut"], bytesIn: row["bytesIn"],
                              destinationCount: row["destinationCount"],
                              lastSeen: Date(timeIntervalSince1970: Double(row["lastSeenMs"] as Int64) / 1000))
                }
        }
    }

    /// 7×24 egress grid (day-of-week × hour) for the activity heatmap (spec §7.3).
    /// `grid[day][hour]` — day 0 = Sunday, matching Calendar's weekday ordering.
    public func activityHeatmap(processLabel: String? = nil, since: Date,
                                calendar: Calendar = .current) throws -> [[Int]] {
        var grid = Array(repeating: Array(repeating: 0, count: 24), count: 7)
        let rows = try writerForTesting.read { db in
            if let processLabel {
                return try Row.fetchAll(db, sql: """
                    SELECT openedAtMs, bytesOut FROM flows
                    WHERE processLabel = ? AND openedAtMs >= ?
                    """, arguments: [processLabel, Int64(since.timeIntervalSince1970 * 1000)])
            }
            return try Row.fetchAll(db, sql: """
                SELECT openedAtMs, bytesOut FROM flows WHERE openedAtMs >= ?
                """, arguments: [Int64(since.timeIntervalSince1970 * 1000)])
        }
        for row in rows {
            let date = Date(timeIntervalSince1970: Double(row["openedAtMs"] as Int64) / 1000)
            let components = calendar.dateComponents([.weekday, .hour], from: date)
            guard let weekday = components.weekday, let hour = components.hour else { continue }
            grid[weekday - 1][hour] += row["bytesOut"] as Int
        }
        return grid
    }

    /// Anomalies for an app: destinations never seen before the window, and
    /// volume far above its own daily baseline (spec §7.3).
    public func anomalies(processLabel: String, since: Date, now: Date = Date(),
                          spikeFactor: Double = 10) throws -> [Anomaly] {
        try writerForTesting.read { db in
            var result: [Anomaly] = []
            let sinceMs = Int64(since.timeIntervalSince1970 * 1000)

            let fresh = try String.fetchAll(db, sql: """
                SELECT DISTINCT COALESCE(host, dst) AS destination FROM flows
                WHERE processLabel = ? AND openedAtMs >= ?
                  AND COALESCE(host, dst) NOT IN (
                      SELECT DISTINCT COALESCE(host, dst) FROM flows
                      WHERE processLabel = ? AND openedAtMs < ?)
                """, arguments: [processLabel, sinceMs, processLabel, sinceMs])
            result.append(contentsOf: fresh.map { .firstEverDestination($0) })

            // Baseline: mean daily egress before the window, from the aggregates
            // that survive detail retention.
            let today = Self.dayString(date: now)
            let baseline = try Row.fetchOne(db, sql: """
                SELECT AVG(bytesOut) AS mean FROM app_day_aggregates
                WHERE appLabel = ? AND day < ?
                """, arguments: [processLabel, today])
            let current = try Int.fetchOne(db, sql: """
                SELECT COALESCE(SUM(bytesOut), 0) FROM flows
                WHERE processLabel = ? AND openedAtMs >= ?
                """, arguments: [processLabel, sinceMs]) ?? 0

            if let mean = baseline?["mean"] as Double?, mean > 0 {
                let multiple = Double(current) / mean
                if multiple >= spikeFactor {
                    result.append(.volumeSpike(multiple: multiple))
                }
            }
            return result
        }
    }

    static func dayString(date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}
