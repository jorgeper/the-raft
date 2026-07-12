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

    @Published private(set) var tapConnected = false
    @Published private(set) var recent: [RecentEntry] = []
    @Published private(set) var series: [EgressMeter.Sample] = []
    @Published private(set) var topApps: [(name: String, bytes: Int)] = []
    @Published private(set) var learningRemaining: TimeInterval = 0
    @Published private(set) var digest: [(app: String, destination: String, flows: Int, bytes: Int)] = []
    @Published var showDigest = false
    @Published var paused = false {
        didSet {
            guard oldValue != paused else { return }
            paused ? stopTap() : startTap()
        }
    }
    @Published var showSystem = UserDefaults.standard.bool(forKey: "showSystem") {
        didSet { UserDefaults.standard.set(showSystem, forKey: "showSystem") }
    }

    var visibleRecent: [RecentEntry] {
        showSystem ? recent : recent.filter { !$0.flow.isSystem }
    }

    let store: AuditStore
    private let pipeline: FlowPipeline
    private var tap: (any FlowTap)?
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
        pipeline = FlowPipeline(store: store)

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

        startTap()

        uiTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshDerivedState() }
        }
        try? store.applyRetention(detailDays: 30)
    }

    // MARK: - Tap lifecycle

    private func startTap() {
        let tap: any FlowTap
        if ProcessInfo.processInfo.environment["GARGOYLE_MOCK_TAP"] != nil {
            tap = MockTap(script: MockScript.demoLoop, loops: true)
        } else {
            tap = PcapTap()
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
        }
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
