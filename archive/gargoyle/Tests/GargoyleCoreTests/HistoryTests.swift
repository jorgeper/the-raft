import Testing
import Foundation
@testable import GargoyleCore

private let base = Date(timeIntervalSince1970: 1_700_000_000)   // 2023-11-14 22:13 UTC

private func seed(_ store: AuditStore, comm: String = "Slack", pid: Int32 = 100,
                  host: String?, ip: String, port: UInt16 = 443,
                  out: Int, `in`: Int, at: Date, verdict: Verdict = .monitored) throws {
    try store.appendFlow(FlowDraft(
        openedAt: at, closedAt: at.addingTimeInterval(5), appIdentityID: nil,
        pid: pid, comm: comm, processLabel: "\(comm)(\(pid))",
        host: host, proto: 6, src: "192.168.1.5", sport: 50000,
        dst: ip, dport: port, ifname: "en0",
        bytesOut: out, bytesIn: `in`, verdict: verdict, tap: .pcap))
}

@Suite struct DestinationNodeTests {
    @Test func groupsDestinationsAndClassifies() throws {
        let store = try AuditStore.inMemory()
        try seed(store, host: "api.slack.com", ip: "3.4.5.6", out: 100, in: 200, at: base)
        try seed(store, host: "api.slack.com", ip: "3.4.5.6", out: 50, in: 100, at: base.addingTimeInterval(60))
        try seed(store, host: "telemetry.example", ip: "9.9.9.9", out: 10, in: 5,
                 at: base.addingTimeInterval(120), verdict: .blocked)

        let nodes = try store.destinationNodes(processLabel: "Slack(100)",
                                               since: base.addingTimeInterval(-3600),
                                               until: base.addingTimeInterval(3600))
        #expect(nodes.count == 2)

        let slack = try #require(nodes.first { $0.destination == "api.slack.com" })
        #expect(slack.flowCount == 2)
        #expect(slack.bytesOut == 150)
        #expect(slack.bytesIn == 300)
        #expect(slack.category == .messaging, "classified from the heuristics DB")
        #expect(slack.service == "Slack")
        #expect(!slack.everBlocked)

        let unknown = try #require(nodes.first { $0.destination == "telemetry.example" })
        #expect(unknown.category == .unknown, "unclassified destinations go to the outer ring")
        #expect(unknown.everBlocked)

        // Sorted by volume: the biggest talker leads.
        #expect(nodes.first?.destination == "api.slack.com")
    }

    @Test func windowExcludesOlderFlows() throws {
        let store = try AuditStore.inMemory()
        try seed(store, host: "old.example", ip: "1.1.1.1", out: 1, in: 1,
                 at: base.addingTimeInterval(-86400))
        try seed(store, host: "new.example", ip: "2.2.2.2", out: 1, in: 1, at: base)

        let nodes = try store.destinationNodes(processLabel: "Slack(100)",
                                               since: base.addingTimeInterval(-60),
                                               until: base.addingTimeInterval(60))
        #expect(nodes.map(\.destination) == ["new.example"])
    }
}

@Suite struct AppRollupTests {
    @Test func rollsUpPerAppSortedByVolume() throws {
        let store = try AuditStore.inMemory()
        try seed(store, comm: "Slack", pid: 1, host: "api.slack.com", ip: "3.4.5.6",
                 out: 100, in: 100, at: base)
        try seed(store, comm: "node", pid: 2, host: "api.github.com", ip: "140.82.113.4",
                 out: 5000, in: 200, at: base)
        try seed(store, comm: "node", pid: 2, host: "registry.npmjs.org", ip: "104.16.11.34",
                 out: 10, in: 900, at: base)

        let rollups = try store.appRollups(since: base.addingTimeInterval(-60))
        #expect(rollups.count == 2)
        #expect(rollups[0].processLabel == "node(2)", "the biggest talker sorts first")
        #expect(rollups[0].flowCount == 2)
        #expect(rollups[0].destinationCount == 2)
        #expect(rollups[0].totalBytes == 6110)
        #expect(rollups[1].processLabel == "Slack(1)")
    }
}

@Suite struct HeatmapTests {
    @Test func bucketsByWeekdayAndHour() throws {
        let store = try AuditStore.inMemory()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!

        // 2023-11-14 is a Tuesday (weekday 3 → index 2).
        let tuesday3am = calendar.date(from: DateComponents(
            timeZone: TimeZone(identifier: "UTC"), year: 2023, month: 11, day: 14, hour: 3))!
        let tuesday3amAgain = tuesday3am.addingTimeInterval(600)
        let wednesday10am = calendar.date(from: DateComponents(
            timeZone: TimeZone(identifier: "UTC"), year: 2023, month: 11, day: 15, hour: 10))!

        try seed(store, host: "a.example", ip: "1.1.1.1", out: 100, in: 0, at: tuesday3am)
        try seed(store, host: "a.example", ip: "1.1.1.1", out: 50, in: 0, at: tuesday3amAgain)
        try seed(store, host: "b.example", ip: "2.2.2.2", out: 7, in: 0, at: wednesday10am)

        let grid = try store.activityHeatmap(processLabel: "Slack(100)",
                                             since: tuesday3am.addingTimeInterval(-3600),
                                             calendar: calendar)
        #expect(grid.count == 7)
        #expect(grid[0].count == 24)
        #expect(grid[2][3] == 150, "both Tuesday 03:00 flows land in one cell")
        #expect(grid[3][10] == 7)
        #expect(grid[5][12] == 0)
    }
}

@Suite struct AnomalyTests {
    @Test func flagsFirstEverDestination() throws {
        let store = try AuditStore.inMemory()
        let old = base.addingTimeInterval(-7 * 86400)
        try seed(store, host: "known.example", ip: "1.1.1.1", out: 100, in: 0, at: old)

        let windowStart = base.addingTimeInterval(-60)
        try seed(store, host: "known.example", ip: "1.1.1.1", out: 100, in: 0, at: base)
        try seed(store, host: "brand-new.example", ip: "9.9.9.9", out: 10, in: 0, at: base)

        let anomalies = try store.anomalies(processLabel: "Slack(100)", since: windowStart, now: base)
        #expect(anomalies.contains(.firstEverDestination("brand-new.example")))
        #expect(!anomalies.contains(.firstEverDestination("known.example")))
    }

    @Test func flagsVolumeSpikeAgainstBaseline() throws {
        let store = try AuditStore.inMemory()
        // Baseline: a few earlier days at ~100 bytes each.
        for day in 1...3 {
            try seed(store, host: "known.example", ip: "1.1.1.1", out: 100, in: 0,
                     at: base.addingTimeInterval(-Double(day) * 86400))
        }
        // Today: 50× the daily mean.
        try seed(store, host: "known.example", ip: "1.1.1.1", out: 5000, in: 0, at: base)

        let anomalies = try store.anomalies(processLabel: "Slack(100)",
                                            since: base.addingTimeInterval(-60), now: base)
        let spike = anomalies.compactMap { anomaly -> Double? in
            if case .volumeSpike(let multiple) = anomaly { return multiple }
            return nil
        }.first
        #expect(spike != nil)
        #expect((spike ?? 0) >= 10)
    }

    @Test func quietAppHasNoAnomalies() throws {
        let store = try AuditStore.inMemory()
        for day in 1...3 {
            try seed(store, host: "known.example", ip: "1.1.1.1", out: 100, in: 0,
                     at: base.addingTimeInterval(-Double(day) * 86400))
        }
        try seed(store, host: "known.example", ip: "1.1.1.1", out: 110, in: 0, at: base)

        let anomalies = try store.anomalies(processLabel: "Slack(100)",
                                            since: base.addingTimeInterval(-60), now: base)
        #expect(anomalies.isEmpty, "normal traffic to a known destination is not an anomaly")
    }
}
