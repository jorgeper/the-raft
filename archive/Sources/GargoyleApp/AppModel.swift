import SwiftUI
import Combine
import GargoyleCore
import CaptureKit

@MainActor
final class AppModel: ObservableObject {
    struct RecentEntry: Identifiable {
        var flow: ActiveFlow
        var closed: Bool
        var id: UInt64 { flow.id }
    }

    /// A would-have-blocked flow or an unanswered prompt, awaiting review.
    struct ReviewItem: Identifiable {
        var id: UInt64
        var appName: String
        var destination: String
        var reason: String
        var at: Date
    }

    @Published private(set) var tapConnected = false
    @Published private(set) var monitorOnly = true
    @Published private(set) var recent: [RecentEntry] = []
    @Published private(set) var series: [EgressMeter.Sample] = []
    @Published private(set) var topApps: [(name: String, bytes: Int)] = []
    @Published private(set) var learningRemaining: TimeInterval = 0
    @Published private(set) var digest: [(app: String, destination: String, flows: Int, bytes: Int)] = []
    @Published private(set) var pendingApprovals: [PendingApproval] = []
    @Published private(set) var reviewQueue: [ReviewItem] = []
    @Published private(set) var profiles: [Profile] = []
    @Published private(set) var activeProfileID: Int64 = 0
    @Published private(set) var appModes: [AppKey: AppMode] = [:]
    @Published var showDigest = false
    @Published var showReview = false
    @Published var paused = false {
        didSet {
            guard oldValue != paused else { return }
            paused ? stopTap() : startTap()
        }
    }
    @Published var showSystem = UserDefaults.standard.bool(forKey: "showSystem") {
        didSet {
            UserDefaults.standard.set(showSystem, forKey: "showSystem")
            Task { await pipeline.setIncludeSystemApps(showSystem) }
        }
    }

    var visibleRecent: [RecentEntry] {
        showSystem ? recent : recent.filter { !$0.flow.isSystem }
    }

    let store: AuditStore
    let ruleStore: RuleStore?
    private let pipeline: FlowPipeline
    private var tap: (any FlowTap)?
    private var flowApps: [UInt64: AppKey] = [:]
    private lazy var approvalWindow: ApprovalWindowController? = {
        // Headless verification runs (GARGOYLE_AUTOEXIT) must not pop windows.
        ProcessInfo.processInfo.environment["GARGOYLE_NO_PROMPT"] != nil
            ? nil : ApprovalWindowController(model: self)
    }()
    private var meter = EgressMeter()
    private var coalescer = NotificationCoalescer()
    private let notifier = Notifier()
    private var pipelineTasks: [Task<Void, Never>] = []
    private var uiTimer: Timer?
    private var appBytes: [String: Int] = [:]
    private var flowTotals: [UInt64: Int] = [:]
    private let learningStart: Date
    private var learningUntil: Date

    private var learningActive: Bool { Date() < learningUntil }

    init() {
        // Mock mode must not pollute the real audit chain.
        let isMock = ProcessInfo.processInfo.environment["GARGOYLE_MOCK_TAP"] != nil
        let store: AuditStore
        do {
            store = isMock ? try AuditStore.inMemory()
                           : try AuditStore(path: AuditStore.defaultDatabasePath())
        } catch {
            fputs("[gargoyle] falling back to in-memory audit store: \(error)\n", stderr)
            store = (try? AuditStore.inMemory())!
        }
        self.store = store
        let ruleStore = try? RuleStore(store: store)
        self.ruleStore = ruleStore
        // Mock flows carry synthetic pids that no longer exist, so SecCode
        // can't identify them: fake the identities to match the demo script.
        pipeline = isMock
            ? FlowPipeline(store: store, ruleStore: ruleStore, resolveIdentity: MockScript.resolver)
            : FlowPipeline(store: store, ruleStore: ruleStore)

        // First launch starts a 1-hour learning window (spec §4): collect a
        // baseline silently, then offer the digest for review.
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "learningStart") == nil {
            let now = Date()
            defaults.set(now.timeIntervalSince1970, forKey: "learningStart")
            defaults.set(now.addingTimeInterval(3600).timeIntervalSince1970, forKey: "learningUntil")
        }
        learningStart = Date(timeIntervalSince1970: defaults.double(forKey: "learningStart"))
        learningUntil = Date(timeIntervalSince1970: defaults.double(forKey: "learningUntil"))

        if isMock { seedMockRules() }
        startTap()
        reloadRuleState()

        uiTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshDerivedState() }
        }
        try? store.applyRetention(detailDays: 30)
    }

    // MARK: - Rules, profiles, modes

    /// Demo state for GARGOYLE_MOCK_TAP: a blocked destination, a firewalled
    /// app, and a second profile — so a mock run exercises every rules path.
    private func seedMockRules() {
        guard let ruleStore else { return }
        do {
            let profileID = try ruleStore.activeProfile().id
            // node → api.github.com is blocked by rule; Slack is firewalled with
            // no rule (so it prompts); Safari just monitors; nsurlsessiond is a
            // system daemon and is excluded. One flow per code path.
            try ruleStore.addRule(Rule(id: 0, profileID: profileID, app: .anyApp,
                                       destination: .suffix("github.com"), action: .block,
                                       notes: "demo: block GitHub API"))
            try ruleStore.setMode(.firewall, for: AppKey(signingID: "com.example.Slack",
                                                         teamID: "TEAM42", path: nil))
            let paranoid = try ruleStore.createProfile(name: "Paranoid")
            try ruleStore.addRule(Rule(id: 0, profileID: paranoid, app: .anyApp,
                                       destination: .any, action: .block,
                                       notes: "demo: block everything"))
        } catch {
            fputs("[gargoyle] mock seeding failed: \(error)\n", stderr)
        }
    }

    private func reloadRuleState() {
        guard let ruleStore else { return }
        profiles = (try? ruleStore.profiles()) ?? []
        activeProfileID = (try? ruleStore.activeProfile().id) ?? 0
        appModes = (try? ruleStore.modes()) ?? [:]
        let includeSystem = showSystem
        Task {
            await pipeline.reloadRules()
            await pipeline.setIncludeSystemApps(includeSystem)
        }
    }

    func activateProfile(_ id: Int64) {
        guard let ruleStore else { return }
        try? ruleStore.activateProfile(id: id)
        reloadRuleState()
    }

    func setMode(_ mode: AppMode, for flow: ActiveFlow) {
        guard let ruleStore else { return }
        try? ruleStore.setMode(mode, for: flow.appKey)
        reloadRuleState()
    }

    func mode(for flow: ActiveFlow) -> AppMode {
        appModes[flow.appKey] ?? .monitor
    }

    /// Most recent flow for a display name — the handle the mode toggles need,
    /// since modes key on the app's signing identity, not its name.
    func latestFlow(named name: String) -> ActiveFlow? {
        recent.first { $0.flow.displayName == name }?.flow
    }

    func resolveApproval(_ approval: PendingApproval, action: RuleAction,
                         scope: RuleScope, destination: Destination? = nil) {
        pendingApprovals.removeAll { $0.id == approval.id }
        Task {
            await pipeline.resolveApproval(id: approval.id, action: action,
                                           scope: scope, destination: destination)
            await MainActor.run { self.reloadRuleState() }
        }
    }

    // MARK: - Tap lifecycle

    private func startTap() {
        let tap: any FlowTap
        if ProcessInfo.processInfo.environment["GARGOYLE_MOCK_TAP"] != nil {
            tap = MockTap(script: MockScript.demoLoop, loops: true)
            monitorOnly = true
        } else {
            // Prefer the content filter when it can actually block; otherwise
            // degrade to monitor-only and say so in the UI (spec §3).
            let selection = TapSelector.select()
            tap = selection.tap
            monitorOnly = selection.monitorOnly
        }
        self.tap = tap

        // Subscribe before running so no early events are missed.
        pipelineTasks.append(Task { [pipeline] in
            let stream = await pipeline.events()
            for await event in stream {
                await MainActor.run { self.handle(event) }
            }
        })
        pipelineTasks.append(Task { [pipeline] in
            await pipeline.run(tap: tap)
        })
    }

    private func stopTap() {
        tap?.stop()
        tap = nil
        pipelineTasks.forEach { $0.cancel() }
        pipelineTasks.removeAll()
        tapConnected = false
    }

    // MARK: - Pipeline events

    private func handle(_ event: PipelineEvent) {
        switch event {
        case .tapStatusChanged(let connected):
            tapConnected = connected

        case .flowOpened(let flow):
            recent.insert(RecentEntry(flow: flow, closed: false), at: 0)
            if recent.count > 50 { recent.removeLast(recent.count - 50) }
            flowTotals[flow.id] = 0
            maybeNotify(flow)
            logMock("OPEN  \(flow.displayName) → \(flow.destinationLabel)")

        case .flowUpdated(let flow):
            if let index = recent.firstIndex(where: { $0.id == flow.id }) {
                recent[index].flow = flow
            }
            let total = flow.bytesOut + flow.bytesIn
            let delta = total - (flowTotals[flow.id] ?? 0)
            flowTotals[flow.id] = total
            if delta > 0 {
                appBytes[flow.displayName, default: 0] += delta
            }

        case .flowClosed(let flow):
            if let index = recent.firstIndex(where: { $0.id == flow.id }) {
                recent[index].flow = flow
                recent[index].closed = true
            }
            flowTotals.removeValue(forKey: flow.id)

        case .traffic(let deltaOut, let deltaIn, let at):
            meter.add(bytesOut: deltaOut, bytesIn: deltaIn, at: at)

        case .approvalRequested(let approval):
            flowApps[approval.flow.id] = approval.context.appKey
            pendingApprovals.append(approval)
            approvalWindow?.present(approval)
            logMock("APPROVAL\(approval.retrospective ? " (retrospective)" : "") \(approval.flow.displayName) → \(approval.context.destinationLabel)")
            if approval.retrospective {
                // Tap B: the flow already happened — this is a review item, and
                // the prompt must not pretend it is gating anything.
                reviewQueue.insert(ReviewItem(
                    id: approval.id, appName: approval.flow.displayName,
                    destination: approval.context.destinationLabel,
                    reason: "firewall mode, no matching rule (monitor-only tap: not blocked)",
                    at: approval.raisedAt), at: 0)
            }
            notifier.notify(title: "Approval needed: \(approval.flow.displayName)",
                            body: "→ \(approval.context.destinationLabel)")

        case .blocked(let flow, let wouldHaveBlocked):
            reviewQueue.insert(ReviewItem(
                id: flow.id, appName: flow.displayName,
                destination: flow.destinationLabel,
                reason: wouldHaveBlocked ? "would have blocked (monitor-only tap)" : "blocked",
                at: Date()), at: 0)
            if reviewQueue.count > 100 { reviewQueue.removeLast(reviewQueue.count - 100) }
            logMock("BLOCK\(wouldHaveBlocked ? " (would-have)" : "") \(flow.displayName) → \(flow.destinationLabel)")

        case .profileChanged:
            reloadRuleState()
        }
    }

    /// Mock runs are verified from the terminal, so mirror the key events there.
    private func logMock(_ message: String) {
        guard ProcessInfo.processInfo.environment["GARGOYLE_MOCK_TAP"] != nil else { return }
        fputs("[mock] \(message)\n", stderr)
    }

    private func maybeNotify(_ flow: ActiveFlow) {
        guard !learningActive, !flow.isSystem else { return }
        let destination = flow.host ?? flow.dst
        guard coalescer.shouldNotify(app: flow.displayName, destination: destination) else { return }
        notifier.notify(title: "\(flow.displayName) → \(destination)",
                        body: "New outbound connection to \(flow.destinationLabel) (\(flow.protoName))")
    }

    // MARK: - Derived UI state

    private func refreshDerivedState() {
        series = meter.series()
        learningRemaining = max(0, learningUntil.timeIntervalSinceNow)
        topApps = appBytes.sorted { $0.value > $1.value }.prefix(5)
            .map { (name: $0.key, bytes: $0.value) }
    }

    func loadDigest() {
        digest = (try? store.appDestinationSummary(since: learningStart).map {
            (app: $0.processLabel, destination: $0.host, flows: $0.flowCount, bytes: $0.bytes)
        }) ?? []
        showDigest = true
    }

    func endLearningNow() {
        learningUntil = Date()
        UserDefaults.standard.set(learningUntil.timeIntervalSince1970, forKey: "learningUntil")
        learningRemaining = 0
    }
}

extension ActiveFlow {
    var protoName: String {
        switch proto {
        case 6: return "TCP"
        case 17: return "UDP"
        case 1: return "ICMP"
        default: return "IP(\(proto))"
        }
    }
}
