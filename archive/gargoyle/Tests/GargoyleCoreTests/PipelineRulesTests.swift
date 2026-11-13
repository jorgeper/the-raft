import Testing
import Foundation
import CaptureKit
@testable import GargoyleCore

/// Replay fixtures: the tap events a recorded session would produce.
private func newEvent(id: UInt64, ts: Double, pid: Int32, comm: String,
                      dst: String, dport: UInt16, host: String?) -> TapEvent {
    var e = TapEvent(kind: .new)
    e.id = id; e.ts = ts; e.pid = pid; e.comm = comm
    e.proto = 6; e.src = "192.168.1.5"; e.sport = 50000
    e.dst = dst; e.dport = dport; e.host = host; e.ifname = "en0"
    return e
}

private func closeEvent(id: UInt64, ts: Double, out: Int, `in`: Int) -> TapEvent {
    var e = TapEvent(kind: .close)
    e.id = id; e.ts = ts; e.bytesOut = out; e.bytesIn = `in`
    return e
}

private let resolver: @Sendable (Int32, String) -> ResolvedIdentity = { _, comm in
    if comm == "trustd" {
        return ResolvedIdentity(signingID: "com.apple.trustd", teamID: nil,
                                path: "/usr/libexec/trustd", displayName: "trustd", isSystem: true)
    }
    return ResolvedIdentity(signingID: "com.example.\(comm)", teamID: "TEAM42",
                            path: "/Applications/\(comm).app", displayName: comm, isSystem: false)
}

private func appKey(_ comm: String) -> AppKey {
    AppKey(signingID: "com.example.\(comm)", teamID: "TEAM42", path: nil)
}

private let t0 = 1_700_000_000.0

@Suite struct PipelineRulesTests {
    /// Tap B cannot block, so a BLOCK rule records verdict=monitored with
    /// wouldHaveBlocked=true (spec §2.2) — the packets really did leave.
    @Test func tapBLabelsBlockAsWouldHaveBlocked() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        let profileID = try rules.activeProfile().id
        try rules.addRule(Rule(id: 0, profileID: profileID, app: .app(appKey("Slack")),
                               destination: .host("telemetry.slack.com"), action: .block))

        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()

        let script: [(TimeInterval, TapConnectionEvent)] = [
            (0, .event(newEvent(id: 1, ts: t0, pid: 100, comm: "Slack",
                                dst: "3.4.5.6", dport: 443, host: "telemetry.slack.com"))),
            (0, .event(closeEvent(id: 1, ts: t0 + 5, out: 100, in: 200))),
        ]
        await pipeline.run(tap: MockTap(script: script))

        let flows = try audit.recentFlows(limit: 10)
        #expect(flows.count == 1)
        #expect(flows[0].verdict == "monitored", "Tap B must not claim it blocked anything")
        #expect(flows[0].tap == "pcap")

        let verdicts = try rules.verdictEvents()
        let flowVerdict = try #require(verdicts.first { $0.flowSeq != nil })
        #expect(flowVerdict.action == "block")
        #expect(flowVerdict.wouldHaveBlocked)
        #expect(flowVerdict.source == "appDestinationRule")
        #expect(flowVerdict.trace.contains { $0.contains("matched app+destination rule") })
    }

    /// An ALLOW rule records an explicit allowed verdict.
    @Test func allowRuleRecordsAllowedVerdict() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        let profileID = try rules.activeProfile().id
        try rules.addRule(Rule(id: 0, profileID: profileID, app: .app(appKey("Slack")),
                               destination: .suffix("slack.com"), action: .allow))

        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 1, ts: t0, pid: 100, comm: "Slack",
                                dst: "3.4.5.6", dport: 443, host: "api.slack.com"))),
            (0, .event(closeEvent(id: 1, ts: t0 + 1, out: 10, in: 20))),
        ]))

        let flows = try audit.recentFlows(limit: 10)
        #expect(flows[0].verdict == "allowed")
        #expect(try rules.hitCount(id: 1) == 1, "a matched rule's hit count must persist")
    }

    /// Firewall mode + no matching rule → approval request. On Tap B it is
    /// flagged retrospective: the flow already happened.
    @Test func firewallModeRaisesRetrospectiveApprovalOnTapB() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        try rules.setMode(.firewall, for: appKey("sketchy"))

        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()

        let stream = await pipeline.events()
        let collector = Task { () -> PendingApproval? in
            for await event in stream {
                if case .approvalRequested(let approval) = event { return approval }
            }
            return nil
        }
        try await Task.sleep(nanoseconds: 30_000_000)
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 1, ts: t0, pid: 300, comm: "sketchy",
                                dst: "9.9.9.9", dport: 443, host: "unknown.example"))),
            (0, .event(closeEvent(id: 1, ts: t0 + 1, out: 10, in: 20))),
        ]))

        let approval = try #require(await collector.value)
        #expect(approval.retrospective, "Tap B cannot hold a flow — the prompt is a review item")
        #expect(approval.flow.displayName == "sketchy")
        #expect(approval.context.host == "unknown.example")

        // An unanswered prompt is audited as would-have-blocked (fail-closed intent).
        let verdicts = try rules.verdictEvents()
        #expect(verdicts.first { $0.flowSeq != nil }?.wouldHaveBlocked == true)
    }

    /// Approving "always" writes a persistent rule that governs later flows.
    @Test func approvalPersistsRuleAndGovernsNextFlow() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        try rules.setMode(.firewall, for: appKey("sketchy"))

        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 1, ts: t0, pid: 300, comm: "sketchy",
                                dst: "9.9.9.9", dport: 443, host: "cdn.example"))),
        ]))

        let pending = await pipeline.pendingApprovals
        #expect(pending.count == 1)
        await pipeline.resolveApproval(id: 1, action: .allow, scope: .persistent,
                                       destination: .suffix("example"))

        let stored = try rules.activeRules()
        #expect(stored.count == 1)
        #expect(stored[0].action == .allow)
        #expect(stored[0].destination == .suffix("example"))

        // A later flow to the same domain is now allowed outright — no prompt.
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 2, ts: t0 + 100, pid: 300, comm: "sketchy",
                                dst: "9.9.9.9", dport: 443, host: "img.example"))),
            (0, .event(closeEvent(id: 2, ts: t0 + 101, out: 5, in: 5))),
        ]))
        let stillPending = await pipeline.pendingApprovals
        #expect(stillPending.isEmpty, "the persisted rule must satisfy the next flow")

        let flows = try audit.recentFlows(limit: 10)
        #expect(flows.contains { $0.dst == "9.9.9.9" && $0.verdict == "allowed" })
    }

    /// Ignore mode / system bucket: the flow is not audited at all (spec §4).
    @Test func ignoredFlowsAreNotAudited() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        try rules.setMode(.ignore, for: appKey("noisy"))

        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 1, ts: t0, pid: 400, comm: "noisy",
                                dst: "1.1.1.1", dport: 443, host: "noise.example"))),
            (0, .event(closeEvent(id: 1, ts: t0 + 1, out: 10, in: 10))),
            // A system daemon is excluded by default, even without a mode.
            (0, .event(newEvent(id: 2, ts: t0, pid: 50, comm: "trustd",
                                dst: "17.1.1.1", dport: 443, host: "ocsp.apple.com"))),
            (0, .event(closeEvent(id: 2, ts: t0 + 1, out: 10, in: 10))),
        ]))

        #expect(try audit.recentFlows(limit: 10).isEmpty,
                "ignored and system flows must never reach the audit log")
    }

    /// Opting system apps in monitors them, and the chain still verifies.
    @Test func systemAppsAuditedWhenOptedIn() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()
        await pipeline.setIncludeSystemApps(true)

        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 2, ts: t0, pid: 50, comm: "trustd",
                                dst: "17.1.1.1", dport: 443, host: "ocsp.apple.com"))),
            (0, .event(closeEvent(id: 2, ts: t0 + 1, out: 10, in: 10))),
        ]))

        let flows = try audit.recentFlows(limit: 10)
        #expect(flows.count == 1)
        #expect(flows[0].comm == "trustd")
        #expect(try audit.verifyChain() == .valid(rowCount: 1))
    }

    /// Switching profiles swaps the governing rules mid-session (spec §5).
    @Test func profileSwitchChangesVerdicts() async throws {
        let audit = try AuditStore.inMemory()
        let rules = try RuleStore(store: audit)
        let normal = try rules.activeProfile().id
        try rules.addRule(Rule(id: 0, profileID: normal, app: .anyApp,
                               destination: .any, action: .allow))
        let paranoid = try rules.createProfile(name: "Paranoid")
        try rules.addRule(Rule(id: 0, profileID: paranoid, app: .anyApp,
                               destination: .any, action: .block))

        let pipeline = FlowPipeline(store: audit, ruleStore: rules, resolveIdentity: resolver)
        await pipeline.reloadRules()
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 1, ts: t0, pid: 100, comm: "Slack",
                                dst: "3.4.5.6", dport: 443, host: "api.slack.com"))),
            (0, .event(closeEvent(id: 1, ts: t0 + 1, out: 1, in: 1))),
        ]))
        #expect(try audit.recentFlows(limit: 1)[0].verdict == "allowed")

        try rules.activateProfile(id: paranoid)
        await pipeline.reloadRules()
        await pipeline.run(tap: MockTap(script: [
            (0, .event(newEvent(id: 2, ts: t0 + 10, pid: 100, comm: "Slack",
                                dst: "3.4.5.6", dport: 443, host: "api.slack.com"))),
            (0, .event(closeEvent(id: 2, ts: t0 + 11, out: 1, in: 1))),
        ]))

        let verdicts = try rules.verdictEvents()
        #expect(verdicts.first?.action == "block", "the Paranoid profile must now govern")
        #expect(verdicts.first?.wouldHaveBlocked == true)
        #expect(try audit.verifyChain() == .valid(rowCount: 2))
    }
}
