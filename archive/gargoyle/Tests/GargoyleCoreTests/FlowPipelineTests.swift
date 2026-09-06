import Testing
import Foundation
import CaptureKit
@testable import GargoyleCore

/// Flow-replay harness (spec §12): recorded tap events driven through the
/// full pipeline into an in-memory audit store.
private enum Replay {
    static func newEvent(id: UInt64, ts: Double, pid: Int32, comm: String,
                         dst: String, dport: UInt16, host: String? = nil) -> TapEvent {
        var e = TapEvent(kind: .new)
        e.id = id; e.ts = ts
        e.pid = pid; e.comm = comm
        e.proto = 6; e.src = "192.168.1.5"; e.sport = 50000
        e.dst = dst; e.dport = dport; e.host = host; e.ifname = "en0"
        return e
    }

    static func statEvent(id: UInt64, ts: Double, out: Int, `in`: Int) -> TapEvent {
        var e = TapEvent(kind: .stat)
        e.id = id; e.ts = ts; e.bytesOut = out; e.bytesIn = `in`
        return e
    }

    static func closeEvent(id: UInt64, ts: Double, totalOut: Int, totalIn: Int) -> TapEvent {
        var e = TapEvent(kind: .close)
        e.id = id; e.ts = ts; e.bytesOut = totalOut; e.bytesIn = totalIn
        return e
    }

    static let fakeResolver: @Sendable (Int32, String) -> ResolvedIdentity = { pid, comm in
        if comm == "curl" {
            // Deliberately not flagged as a system daemon: system apps are
            // excluded from the pipeline entirely (spec §4), which is covered
            // by PipelineRulesTests.
            return ResolvedIdentity(signingID: "com.apple.curl", teamID: nil,
                                    path: "/usr/bin/curl", displayName: "curl", isSystem: false)
        }
        return ResolvedIdentity(signingID: "com.example.\(comm)", teamID: "TEAM42",
                                path: "/Applications/\(comm).app/Contents/MacOS/\(comm)",
                                displayName: comm, isSystem: false)
    }
}

@Suite struct FlowReplayHarnessTests {
    private let t0 = 1_700_000_000.0

    @Test func replayedSessionLandsInAuditChain() async throws {
        let store = try AuditStore.inMemory()
        let pipeline = FlowPipeline(store: store, resolveIdentity: Replay.fakeResolver)

        let script: [(TimeInterval, TapConnectionEvent)] = [
            (0, .event(.hello(version: TapWire.version, tap: "pcap"))),
            (0, .event(Replay.newEvent(id: 1, ts: t0, pid: 100, comm: "curl",
                                       dst: "93.184.216.34", dport: 443, host: "example.com"))),
            (0, .event(Replay.statEvent(id: 1, ts: t0 + 2, out: 100, in: 2000))),
            (0, .event(Replay.newEvent(id: 2, ts: t0 + 3, pid: 200, comm: "Slack",
                                       dst: "3.4.5.6", dport: 443))),
            (0, .event(Replay.statEvent(id: 1, ts: t0 + 4, out: 50, in: 100))),
            (0, .event(Replay.statEvent(id: 2, ts: t0 + 4, out: 500, in: 900))),
            (0, .event(Replay.closeEvent(id: 1, ts: t0 + 65, totalOut: 150, totalIn: 2100))),
            (0, .event(Replay.closeEvent(id: 2, ts: t0 + 70, totalOut: 500, totalIn: 900))),
        ]
        await pipeline.run(tap: MockTap(script: script))

        let rows = try store.recentFlows(limit: 10)
        #expect(rows.count == 2)

        let curl = try #require(rows.first { $0.comm == "curl" })
        #expect(curl.host == "example.com")
        #expect(curl.bytesOut == 150)
        #expect(curl.bytesIn == 2100)
        #expect(curl.dst == "93.184.216.34")
        #expect(curl.verdict == "monitored")
        #expect(curl.tap == "pcap")
        #expect(curl.appIdentityID != nil)

        let slack = try #require(rows.first { $0.comm == "Slack" })
        #expect(slack.bytesOut == 500)
        #expect(slack.appIdentityID != nil)
        #expect(slack.appIdentityID != curl.appIdentityID)

        #expect(try store.verifyChain() == .valid(rowCount: 2))

        let aggregates = try store.dayAggregates()
        #expect(aggregates.contains { $0.appLabel == "curl(100)" && $0.bytesIn == 2100 })
    }

    @Test func observersSeeLifecycleAndTraffic() async throws {
        let store = try AuditStore.inMemory()
        let pipeline = FlowPipeline(store: store, resolveIdentity: Replay.fakeResolver)

        let script: [(TimeInterval, TapConnectionEvent)] = [
            (0, .event(Replay.newEvent(id: 1, ts: t0, pid: 100, comm: "curl",
                                       dst: "1.2.3.4", dport: 443))),
            (0, .event(Replay.statEvent(id: 1, ts: t0 + 1, out: 10, in: 20))),
            (0, .event(Replay.closeEvent(id: 1, ts: t0 + 2, totalOut: 10, totalIn: 20))),
        ]

        let stream = await pipeline.events()
        let collector = Task { () -> [String] in
            var kinds: [String] = []
            for await event in stream {
                switch event {
                case .tapStatusChanged(let connected): kinds.append("tap:\(connected)")
                case .flowOpened: kinds.append("opened")
                case .flowUpdated: kinds.append("updated")
                case .flowClosed: kinds.append("closed")
                case .traffic(let out, let inn, _): kinds.append("traffic:\(out)/\(inn)")
                case .approvalRequested: kinds.append("approval")
                case .blocked: kinds.append("blocked")
                case .profileChanged: kinds.append("profile")
                }
                if kinds.contains("closed") { break }
            }
            return kinds
        }
        // Give the observer a beat to subscribe before events flow.
        try await Task.sleep(nanoseconds: 50_000_000)
        await pipeline.run(tap: MockTap(script: script))

        let kinds = await collector.value
        #expect(kinds == ["tap:true", "opened", "updated", "traffic:10/20", "closed"])
    }

    /// App quit with flows still open: flushAll finalizes them with current totals.
    @Test func flushFinalizesOpenFlows() async throws {
        let store = try AuditStore.inMemory()
        let pipeline = FlowPipeline(store: store, resolveIdentity: Replay.fakeResolver)

        let script: [(TimeInterval, TapConnectionEvent)] = [
            (0, .event(Replay.newEvent(id: 9, ts: t0, pid: 300, comm: "node",
                                       dst: "9.9.9.9", dport: 443))),
            (0, .event(Replay.statEvent(id: 9, ts: t0 + 1, out: 42, in: 7))),
        ]
        // MockTap's stream ends after the script; run() flushes remaining flows.
        await pipeline.run(tap: MockTap(script: script))

        let rows = try store.recentFlows(limit: 10)
        #expect(rows.count == 1)
        #expect(rows.first?.bytesOut == 42)
        #expect(rows.first?.bytesIn == 7)
        #expect(try store.verifyChain() == .valid(rowCount: 1))
        let flows = await pipeline.activeFlows
        #expect(flows.isEmpty)
    }

    /// Events for unknown flow ids (helper restarted mid-stream) are ignored.
    @Test func toleratesUnknownIds() async throws {
        let store = try AuditStore.inMemory()
        let pipeline = FlowPipeline(store: store, resolveIdentity: Replay.fakeResolver)

        let script: [(TimeInterval, TapConnectionEvent)] = [
            (0, .event(Replay.statEvent(id: 77, ts: t0, out: 10, in: 10))),
            (0, .event(Replay.closeEvent(id: 77, ts: t0 + 1, totalOut: 10, totalIn: 10))),
        ]
        await pipeline.run(tap: MockTap(script: script))
        #expect(try store.recentFlows(limit: 10).isEmpty)
    }
}

@Suite struct AppIdentityResolverTests {
    /// Resolving our own test-runner process must produce a real identity.
    @Test func resolvesOwnProcess() {
        let identity = AppIdentityResolver.resolve(pid: getpid(), fallbackName: "fallback")
        #expect(identity.displayName != "fallback")
        #expect(identity.path != nil)
    }

    @Test func fallsBackForBogusPid() {
        let identity = AppIdentityResolver.resolve(pid: -99, fallbackName: "ghost")
        #expect(identity.displayName == "ghost")
        #expect(identity.signingID == nil)
    }

    @Test func displayNamePrefersAppBundle() {
        #expect(AppIdentityResolver.displayName(
            path: "/Applications/Safari.app/Contents/MacOS/Safari",
            signingID: "com.apple.Safari", fallback: "x") == "Safari")
        #expect(AppIdentityResolver.displayName(
            path: "/usr/bin/curl", signingID: "com.apple.curl", fallback: "x") == "curl")
        #expect(AppIdentityResolver.displayName(
            path: nil, signingID: "com.example.tool", fallback: "x") == "tool")
        #expect(AppIdentityResolver.displayName(
            path: nil, signingID: nil, fallback: "x") == "x")
    }
}
