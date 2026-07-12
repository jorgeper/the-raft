import Foundation
import CaptureKit

/// A flow currently in progress, as shown in the UI.
public struct ActiveFlow: Sendable, Identifiable, Equatable {
    public let id: UInt64
    public let openedAt: Date
    public let pid: Int32
    public let comm: String
    public let processLabel: String
    public let displayName: String
    public let isSystem: Bool
    public let identityID: Int64?
    public let host: String?
    public let proto: UInt8
    public let src: String
    public let sport: UInt16
    public let dst: String
    public let dport: UInt16
    public let ifname: String
    public var bytesOut: Int
    public var bytesIn: Int

    public var destinationLabel: String {
        "\(host ?? dst):\(dport)"
    }
}

/// A flow awaiting a firewall verdict (spec §5 approval prompt). On Tap A the
/// flow is held; on Tap B it has already been allowed through and the item is
/// a retrospective review entry.
public struct PendingApproval: Sendable, Identifiable, Equatable {
    public let id: UInt64
    public let flow: ActiveFlow
    public let context: FlowContext
    public let raisedAt: Date
    /// True when the tap cannot actually hold the flow (Tap B): the connection
    /// already happened and this is a review-queue item, not a live gate.
    public let retrospective: Bool
}

public enum PipelineEvent: Sendable {
    case tapStatusChanged(connected: Bool)
    case flowOpened(ActiveFlow)
    case flowUpdated(ActiveFlow)
    case flowClosed(ActiveFlow)
    /// Per-stat traffic deltas for throughput meters.
    case traffic(deltaOut: Int, deltaIn: Int, at: Date)
    /// A firewall-mode flow with no matching rule needs a human verdict.
    case approvalRequested(PendingApproval)
    /// A rule said block. On Tap B this is "would have blocked" (spec §2.2).
    case blocked(ActiveFlow, wouldHaveBlocked: Bool)
    case profileChanged(Profile)
}

extension FlowContext: Equatable {
    public static func == (lhs: FlowContext, rhs: FlowContext) -> Bool {
        lhs.appKey == rhs.appKey && lhs.host == rhs.host && lhs.ip == rhs.ip
            && lhs.port == rhs.port && lhs.proto == rhs.proto
    }
}

/// The tap-agnostic core (spec §2.3): consumes TapEvents, maintains active
/// flows, resolves app identities, evaluates rules, and finalizes closed flows
/// into the hash-chained audit store. UI layers observe via `events()`.
public actor FlowPipeline {
    private let store: AuditStore
    private let ruleStore: RuleStore?
    private let resolveIdentity: @Sendable (Int32, String) -> ResolvedIdentity

    private var active: [UInt64: ActiveFlow] = [:]
    private var decisions: [UInt64: Decision] = [:]
    private var identityCache: [String: (id: Int64?, displayName: String, isSystem: Bool, key: AppKey)] = [:]
    private var observers: [UUID: AsyncStream<PipelineEvent>.Continuation] = [:]
    private var tapKind: TapKind = .pcap
    private var engine = RulesEngine()
    private var pending: [UInt64: PendingApproval] = [:]

    public init(store: AuditStore, ruleStore: RuleStore? = nil,
                resolveIdentity: @escaping @Sendable (Int32, String) -> ResolvedIdentity
                    = { AppIdentityResolver.resolve(pid: $0, fallbackName: $1) }) {
        self.store = store
        self.ruleStore = ruleStore
        self.resolveIdentity = resolveIdentity
    }

    // MARK: - Rules

    /// Loads the active profile's rules and per-app modes into the engine.
    /// Called at startup and after any rule/profile/mode change.
    public func reloadRules() {
        guard let ruleStore else { return }
        do {
            engine.replaceRules(try ruleStore.activeRules())
            for (app, mode) in try ruleStore.modes() {
                engine.setMode(app, mode)
            }
        } catch {
            fputs("[gargoyle] rule reload failed: \(error)\n", stderr)
        }
    }

    public func setIncludeSystemApps(_ include: Bool) {
        engine.includeSystemApps = include
    }

    public var pendingApprovals: [PendingApproval] {
        Array(pending.values).sorted { $0.raisedAt < $1.raisedAt }
    }

    /// Resolves a prompt. Persistent scopes become rules in the active profile;
    /// session scopes live in memory only.
    public func resolveApproval(id: UInt64, action: RuleAction, scope: RuleScope,
                                destination: Destination? = nil) {
        guard let item = pending.removeValue(forKey: id) else { return }
        let target = destination ?? item.context.host.map { Destination.host($0) }
            ?? .ip(item.context.ip)

        if scope.isSessionScoped {
            engine.addSessionApproval(app: item.context.appKey, destination: target,
                                      action: action, scope: scope)
        } else if let ruleStore {
            do {
                let profileID = try ruleStore.activeProfile().id
                try ruleStore.addRule(Rule(id: 0, profileID: profileID,
                                           app: .app(item.context.appKey),
                                           destination: target, action: action, scope: scope))
                reloadRules()
            } catch {
                fputs("[gargoyle] failed to persist approval: \(error)\n", stderr)
            }
        }
        // Record the human verdict against the flow.
        let decision = Decision(action: action.flowAction, source: .sessionApproval,
                                matchedRuleID: nil,
                                trace: ["human approval: \(action.rawValue) \(scope.label) for \(target.displayString)"])
        decisions[id] = decision
        try? ruleStore?.recordVerdict(flowSeq: nil, decision: decision,
                                      wouldHaveBlocked: action == .block && tapKind == .pcap)
    }

    // MARK: - Observation

    public func events() -> AsyncStream<PipelineEvent> {
        AsyncStream { continuation in
            let key = UUID()
            observers[key] = continuation
            continuation.onTermination = { _ in
                Task { [weak self] in await self?.removeObserver(key) }
            }
        }
    }

    private func removeObserver(_ key: UUID) {
        observers.removeValue(forKey: key)
    }

    private func emit(_ event: PipelineEvent) {
        for continuation in observers.values {
            continuation.yield(event)
        }
    }

    public var activeFlows: [ActiveFlow] {
        Array(active.values)
    }

    // MARK: - Running

    /// Consumes a tap's stream until it finishes. Call from a long-lived Task.
    public func run(tap: any FlowTap) async {
        tapKind = tap.kind
        for await connectionEvent in tap.events() {
            switch connectionEvent {
            case .connected:
                emit(.tapStatusChanged(connected: true))
            case .disconnected:
                emit(.tapStatusChanged(connected: false))
            case .event(let event):
                handle(event)
            }
        }
        try? flushAll()
    }

    private func handle(_ event: TapEvent) {
        switch event.kind {
        case .hello:
            break
        case .new:
            guard let id = event.id else { return }
            let pid = event.pid ?? 0
            let comm = event.comm ?? "?"
            let identity = cachedIdentity(pid: pid, comm: comm)
            let processLabel = Self.processLabel(pid: pid, comm: comm,
                                                 epid: event.epid, ecomm: event.ecomm)
            let flow = ActiveFlow(
                id: id,
                openedAt: event.ts.map { Date(timeIntervalSince1970: $0) } ?? Date(),
                pid: pid, comm: comm, processLabel: processLabel,
                displayName: identity.displayName, isSystem: identity.isSystem,
                identityID: identity.id,
                host: event.host, proto: event.proto ?? 0,
                src: event.src ?? "?", sport: event.sport ?? 0,
                dst: event.dst ?? "?", dport: event.dport ?? 0,
                ifname: event.ifname ?? "?",
                bytesOut: 0, bytesIn: 0)

            let context = FlowContext(
                appKey: identity.key, appName: identity.displayName,
                isSystem: identity.isSystem, host: flow.host, ip: flow.dst,
                port: flow.dport, proto: flow.proto)
            let decision = engine.evaluate(context)
            decisions[id] = decision

            switch decision.action {
            case .ignore:
                // Not monitored at all (system bucket / Ignore mode): the flow
                // never enters the pipeline, so it is never audited.
                return
            case .prompt:
                // Firewall mode, no matching rule. Tap A holds the flow; Tap B
                // cannot, so the prompt becomes a retrospective review item
                // (spec §2.2 "would-have-blocked").
                let approval = PendingApproval(
                    id: id, flow: flow, context: context, raisedAt: Date(),
                    retrospective: tapKind == .pcap)
                pending[id] = approval
                active[id] = flow
                emit(.flowOpened(flow))
                emit(.approvalRequested(approval))
                return
            case .block:
                let wouldHaveBlocked = tapKind == .pcap
                active[id] = flow
                emit(.flowOpened(flow))
                emit(.blocked(flow, wouldHaveBlocked: wouldHaveBlocked))
                try? ruleStore?.recordVerdict(flowSeq: nil, decision: decision,
                                              wouldHaveBlocked: wouldHaveBlocked)
                return
            case .allow, .alert:
                active[id] = flow
                emit(.flowOpened(flow))
            }
        case .stat:
            guard let id = event.id, var flow = active[id] else { return }
            let deltaOut = event.bytesOut ?? 0
            let deltaIn = event.bytesIn ?? 0
            flow.bytesOut += deltaOut
            flow.bytesIn += deltaIn
            active[id] = flow
            emit(.flowUpdated(flow))
            emit(.traffic(deltaOut: deltaOut, deltaIn: deltaIn,
                          at: event.ts.map { Date(timeIntervalSince1970: $0) } ?? Date()))
        case .close:
            guard let id = event.id, var flow = active.removeValue(forKey: id) else { return }
            // Close carries authoritative totals.
            flow.bytesOut = event.bytesOut ?? flow.bytesOut
            flow.bytesIn = event.bytesIn ?? flow.bytesIn
            finalize(flow, closedAt: event.ts.map { Date(timeIntervalSince1970: $0) } ?? Date())
            emit(.flowClosed(flow))
        }
    }

    /// Finalizes all active flows (app quit, tap stream end).
    public func flushAll(at now: Date = Date()) throws {
        for flow in active.values {
            finalize(flow, closedAt: now)
            emit(.flowClosed(flow))
        }
        active.removeAll()
    }

    private func finalize(_ flow: ActiveFlow, closedAt: Date) {
        let decision = decisions.removeValue(forKey: flow.id)
        // A pending approval outlives its flow: on Tap B the connection has
        // already completed, and the item still needs a human verdict in the
        // review queue. It clears only when resolved.

        // What actually happened to the traffic. Only Tap A can truly block;
        // on Tap B a block decision is recorded as monitored + would-have-blocked
        // (spec §2.2), because the packets did in fact leave.
        let verdict: Verdict
        var wouldHaveBlocked = false
        switch decision?.action {
        case .allow:
            verdict = .allowed
        case .block:
            if tapKind == .filter {
                verdict = .blocked
            } else {
                verdict = .monitored
                wouldHaveBlocked = true
            }
        case .prompt:
            // Unanswered prompt: fail-closed on Tap A (spec §2.1), observed on Tap B.
            if tapKind == .filter {
                verdict = .blocked
            } else {
                verdict = .monitored
                wouldHaveBlocked = true
            }
        default:
            verdict = .monitored
        }

        let draft = FlowDraft(
            openedAt: flow.openedAt, closedAt: closedAt,
            appIdentityID: flow.identityID,
            pid: flow.pid, comm: flow.comm, processLabel: flow.processLabel,
            host: flow.host, proto: flow.proto,
            src: flow.src, sport: flow.sport,
            dst: flow.dst, dport: flow.dport, ifname: flow.ifname,
            bytesOut: flow.bytesOut, bytesIn: flow.bytesIn,
            verdict: verdict, tap: tapKind)
        do {
            let record = try store.appendFlow(draft)
            if let decision, let ruleStore {
                // The trace is what answers "why was this allowed/blocked?"
                try ruleStore.recordVerdict(flowSeq: record.seq, decision: decision,
                                            wouldHaveBlocked: wouldHaveBlocked)
                try ruleStore.recordHits(engine.drainHitCounts())
            }
        } catch {
            // An audit write failure must not kill the capture loop; the flow
            // remains visible in the UI stream even though it wasn't persisted.
            fputs("[gargoyle] audit append failed: \(error)\n", stderr)
        }
    }

    // MARK: - Identity

    private func cachedIdentity(pid: Int32, comm: String)
        -> (id: Int64?, displayName: String, isSystem: Bool, key: AppKey) {
        let cacheKey = "\(pid)|\(comm)"
        if let cached = identityCache[cacheKey] {
            return cached
        }
        let resolved = resolveIdentity(pid, comm)
        var identityID: Int64?
        do {
            identityID = try store.upsertIdentity(
                signingID: resolved.signingID, teamID: resolved.teamID,
                path: resolved.path, displayName: resolved.displayName,
                isSystem: resolved.isSystem)
        } catch {
            identityID = nil
        }
        // Rules key on signing identity, so an unsigned binary falls back to path.
        let appKey = AppKey(signingID: resolved.signingID, teamID: resolved.teamID,
                            path: resolved.signingID == nil ? resolved.path : nil)
        let entry = (id: identityID, displayName: resolved.displayName,
                     isSystem: resolved.isSystem, key: appKey)
        identityCache[cacheKey] = entry
        return entry
    }

    static func processLabel(pid: Int32, comm: String, epid: Int32?, ecomm: String?) -> String {
        if let epid, let ecomm, epid > 0, epid != pid, !ecomm.isEmpty, ecomm != comm {
            return "\(comm)(\(pid)) for \(ecomm)(\(epid))"
        }
        return "\(comm)(\(pid))"
    }
}
