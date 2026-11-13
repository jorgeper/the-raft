import Testing
import Foundation
import GRDB
@testable import GargoyleCore

private func makeDraft(comm: String = "curl", pid: Int32 = 100,
                       dst: String = "1.2.3.4", dport: UInt16 = 443,
                       host: String? = "example.com",
                       bytesOut: Int = 1000, bytesIn: Int = 2000,
                       openedAt: Date = Date(timeIntervalSince1970: 1_700_000_000),
                       closedAt: Date = Date(timeIntervalSince1970: 1_700_000_060)) -> FlowDraft {
    FlowDraft(openedAt: openedAt, closedAt: closedAt,
              appIdentityID: nil, pid: pid, comm: comm, processLabel: "\(comm)(\(pid))",
              host: host, proto: 6, src: "192.168.1.5", sport: 50000,
              dst: dst, dport: dport, ifname: "en0",
              bytesOut: bytesOut, bytesIn: bytesIn,
              verdict: .monitored, tap: .pcap)
}

@Suite struct AuditStoreChainTests {
    @Test func appendsAndVerifies() throws {
        let store = try AuditStore.inMemory()
        let first = try store.appendFlow(makeDraft(comm: "curl"))
        let second = try store.appendFlow(makeDraft(comm: "Safari"))
        let third = try store.appendFlow(makeDraft(comm: "node"))

        #expect(first.seq == 1)
        #expect(second.seq == 2)
        #expect(third.seq == 3)
        #expect(second.prevHash == first.hash)
        #expect(third.prevHash == second.hash)
        #expect(first.hash.count == 64)

        #expect(try store.verifyChain() == .valid(rowCount: 3))
    }

    @Test func emptyChainIsValid() throws {
        let store = try AuditStore.inMemory()
        #expect(try store.verifyChain() == .valid(rowCount: 0))
    }

    @Test func detectsFieldTampering() throws {
        let store = try AuditStore.inMemory()
        try store.appendFlow(makeDraft())
        let victim = try store.appendFlow(makeDraft(comm: "evil"))
        try store.appendFlow(makeDraft())

        // Rewrite history: shrink the byte count of the middle row via raw SQL.
        let victimSeq = try #require(victim.seq)
        try store.writerForTesting.write { db in
            try db.execute(sql: "UPDATE flows SET bytesOut = 1 WHERE seq = ?", arguments: [victimSeq])
        }
        #expect(try store.verifyChain() == .broken(atSeq: victimSeq))
    }

    @Test func detectsDeletedMiddleRow() throws {
        let store = try AuditStore.inMemory()
        try store.appendFlow(makeDraft())
        let victim = try store.appendFlow(makeDraft())
        let last = try store.appendFlow(makeDraft())

        try store.writerForTesting.write { db in
            try db.execute(sql: "DELETE FROM flows WHERE seq = ?", arguments: [victim.seq])
        }
        #expect(try store.verifyChain() == .broken(atSeq: try #require(last.seq)))
    }

    /// Retention deletes from the head of the chain; the remainder must still verify.
    @Test func retentionPreservesVerifiability() throws {
        let store = try AuditStore.inMemory()
        let old = Date(timeIntervalSince1970: 1_700_000_000)
        let recent = Date()
        try store.appendFlow(makeDraft(openedAt: old, closedAt: old.addingTimeInterval(5)))
        try store.appendFlow(makeDraft(openedAt: old, closedAt: old.addingTimeInterval(9)))
        try store.appendFlow(makeDraft(openedAt: recent, closedAt: recent))

        try store.applyRetention(detailDays: 30, now: Date())

        #expect(try store.recentFlows(limit: 10).count == 1)
        #expect(try store.verifyChain() == .valid(rowCount: 1))
    }
}

@Suite struct AuditStoreQueryTests {
    @Test func recentFlowsNewestFirst() throws {
        let store = try AuditStore.inMemory()
        try store.appendFlow(makeDraft(comm: "first"))
        try store.appendFlow(makeDraft(comm: "second"))

        let recent = try store.recentFlows(limit: 10)
        #expect(recent.map(\.comm) == ["second", "first"])
    }

    @Test func aggregatesPerAppPerDaySurviveRetention() throws {
        let store = try AuditStore.inMemory()
        let day = Date(timeIntervalSince1970: 1_700_000_000)  // 2023-11-14 UTC
        try store.appendFlow(makeDraft(comm: "curl", bytesOut: 100, bytesIn: 10,
                                       openedAt: day, closedAt: day))
        try store.appendFlow(makeDraft(comm: "curl", bytesOut: 200, bytesIn: 20,
                                       openedAt: day, closedAt: day))
        try store.appendFlow(makeDraft(comm: "node", bytesOut: 5, bytesIn: 0,
                                       openedAt: day, closedAt: day))

        try store.applyRetention(detailDays: 30, now: Date())

        let aggregates = try store.dayAggregates()
        let curl = try #require(aggregates.first { $0.appLabel == "curl(100)" })
        #expect(curl.day == "2023-11-14")
        #expect(curl.flowCount == 2)
        #expect(curl.bytesOut == 300)
        #expect(curl.bytesIn == 30)
        #expect(aggregates.first { $0.appLabel == "node(100)" }?.flowCount == 1)
    }

    @Test func identityUpsertReusesRow() throws {
        let store = try AuditStore.inMemory()
        let a = try store.upsertIdentity(signingID: "com.apple.curl", teamID: nil,
                                         path: "/usr/bin/curl", displayName: "curl")
        let b = try store.upsertIdentity(signingID: "com.apple.curl", teamID: nil,
                                         path: "/usr/bin/curl", displayName: "curl")
        let c = try store.upsertIdentity(signingID: "com.example.other", teamID: "ABC123",
                                         path: "/Applications/Other.app", displayName: "Other")
        #expect(a == b)
        #expect(a != c)
    }
}
