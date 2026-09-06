import SwiftUI
import Charts
import GargoyleCore

struct MainWindow: View {
    @ObservedObject var model: AppModel
    @State private var apps: [AppRollup] = []
    @State private var selection: String?
    @State private var section: Section = .constellation

    enum Section: String, CaseIterable, Identifiable {
        case constellation = "Constellation"
        case timeline = "Timeline"
        case rules = "Rules"
        case review = "Review"
        case watchers = "Watchers"
        var id: String { rawValue }
    }

    private var selectedApp: AppRollup? {
        apps.first { $0.processLabel == selection } ?? apps.first
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                SwiftUI.Section("Apps") {
                    ForEach(apps) { app in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(app.displayName).font(.body)
                            Text("\(app.destinationCount) destinations · \(ConstellationView.bytes(app.totalBytes))")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        .tag(app.processLabel)
                    }
                    if apps.isEmpty {
                        Text("No traffic recorded yet")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 190, ideal: 220)
        } detail: {
            VStack(spacing: 0) {
                Picker("", selection: $section) {
                    ForEach(Section.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(8)

                Divider()

                switch section {
                case .constellation:
                    if let app = selectedApp {
                        ConstellationView(model: model, app: app)
                    } else {
                        emptyState("Select an app to see its network constellation.")
                    }
                case .timeline:
                    if let app = selectedApp {
                        TimelineSection(model: model, app: app)
                    } else {
                        emptyState("Select an app to see its activity timeline.")
                    }
                case .rules:
                    RulesSection(model: model)
                case .review:
                    ReviewSection(model: model)
                case .watchers:
                    WatchersSection(model: model)
                }
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onAppear(perform: reload)
        .onReceive(model.tick) { _ in reload() }
    }

    private func emptyState(_ text: String) -> some View {
        VStack {
            Spacer()
            Text(text).foregroundStyle(.secondary)
            Spacer()
        }
    }

    private func reload() {
        apps = (try? model.store.appRollups(since: Date().addingTimeInterval(-7 * 86400))) ?? []
        if selection == nil { selection = apps.first?.processLabel }
    }
}

// MARK: - Timeline (heatmap + rollup + anomalies)

struct TimelineSection: View {
    @ObservedObject var model: AppModel
    let app: AppRollup

    @State private var grid: [[Int]] = []
    @State private var anomalies: [Anomaly] = []
    @State private var nodes: [DestinationNode] = []

    private let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !anomalies.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Anomalies").font(.caption.bold()).foregroundStyle(.orange)
                        ForEach(anomalies.indices, id: \.self) { index in
                            Label(anomalies[index].label, systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                    .padding(10)
                    .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Activity — egress by day and hour")
                        .font(.caption.bold()).foregroundStyle(.secondary)
                    heatmap
                    Text("Why does this app phone home at 3am? The dark cells answer that.")
                        .font(.caption2).foregroundStyle(.tertiary)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Destinations by category")
                        .font(.caption.bold()).foregroundStyle(.secondary)
                    ForEach(DestinationCategory.allCases, id: \.self) { category in
                        let group = nodes.filter { $0.category == category }
                        if !group.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(category.label)
                                    .font(.caption2.bold())
                                    .foregroundStyle(category == .unknown ? .orange : .secondary)
                                ForEach(group) { node in
                                    HStack {
                                        Circle()
                                            .fill(node.everBlocked ? Color.red : Color.green.opacity(0.6))
                                            .frame(width: 5, height: 5)
                                        Text(node.destination).font(.caption)
                                        Text(node.service).font(.caption2).foregroundStyle(.tertiary)
                                        Spacer()
                                        Text(ConstellationView.bytes(node.totalBytes))
                                            .font(.caption2.monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(16)
        }
        .onAppear(perform: reload)
        .onChange(of: app.processLabel) { _, _ in reload() }
        .onReceive(model.tick) { _ in reload() }
    }

    private var heatmap: some View {
        HeatmapGrid(grid: grid)
    }

    private func reload() {
        let since = Date().addingTimeInterval(-7 * 86400)
        grid = (try? model.store.activityHeatmap(processLabel: app.processLabel, since: since))
            ?? Array(repeating: Array(repeating: 0, count: 24), count: 7)
        anomalies = (try? model.store.anomalies(processLabel: app.processLabel,
                                                since: Date().addingTimeInterval(-86400))) ?? []
        nodes = (try? model.store.destinationNodes(processLabel: app.processLabel,
                                                   since: since,
                                                   heuristics: model.heuristics)) ?? []
    }
}

// MARK: - Rules

struct RulesSection: View {
    @ObservedObject var model: AppModel
    @State private var rules: [Rule] = []
    @State private var verdicts: [VerdictEvent] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text("Rules — profile: \(model.profiles.first { $0.id == model.activeProfileID }?.name ?? "—")")
                        .font(.caption.bold()).foregroundStyle(.secondary)
                    Spacer()
                    Button("Export profile") { model.exportActiveProfile() }
                        .controlSize(.small)
                    Button("Import profile") { model.importProfile() }
                        .controlSize(.small)
                }

                if rules.isEmpty {
                    Text("No rules in this profile. Approve or block a flow to create one.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(rules) { rule in
                    HStack {
                        Image(systemName: rule.action == .block ? "hand.raised.fill" : "checkmark.shield")
                            .foregroundStyle(rule.action == .block ? .red : .green)
                            .font(.caption)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(rule.summary).font(.caption)
                            if let notes = rule.notes {
                                Text(notes).font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                        Spacer()
                        Text("\(model.hitCount(rule.id))×")
                            .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                        Button {
                            model.deleteRule(rule.id)
                            reload()
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                    .padding(6)
                    .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 5))
                }

                // Precedence trace: why any recent flow got its verdict (spec §5).
                Text("Recent verdicts — why").font(.caption.bold()).foregroundStyle(.secondary)
                ForEach(verdicts.prefix(15)) { event in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(event.action.uppercased())
                                .font(.caption2.bold())
                                .foregroundStyle(event.action == "block" ? .red : .secondary)
                            if event.wouldHaveBlocked {
                                Text("would-have-blocked")
                                    .font(.caption2).foregroundStyle(.orange)
                            }
                            Text(event.source).font(.caption2).foregroundStyle(.tertiary)
                            Spacer()
                            Text(event.at.formatted(date: .omitted, time: .standard))
                                .font(.caption2).foregroundStyle(.tertiary)
                        }
                        ForEach(event.trace.indices, id: \.self) { index in
                            Text("• \(event.trace[index])")
                                .font(.caption2)
                                .foregroundStyle(index == event.trace.count - 1 ? .primary : .tertiary)
                        }
                    }
                    .padding(6)
                    .background(.quaternary.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
                }
            }
            .padding(16)
        }
        .onAppear(perform: reload)
        .onReceive(model.tick) { _ in reload() }
    }

    private func reload() {
        rules = model.activeRules()
        verdicts = model.recentVerdicts()
    }
}

// MARK: - Review queue

struct ReviewSection: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !model.pendingApprovals.isEmpty {
                    Text("Pending approvals").font(.caption.bold()).foregroundStyle(.orange)
                    ForEach(model.pendingApprovals) { approval in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(approval.flow.displayName).font(.caption)
                                Text(approval.context.destinationLabel)
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Allow") {
                                model.resolveApproval(approval, action: .allow, scope: .persistent)
                            }
                            .controlSize(.small)
                            Button("Block") {
                                model.resolveApproval(approval, action: .block, scope: .persistent)
                            }
                            .controlSize(.small).tint(.red)
                        }
                        .padding(6)
                        .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 5))
                    }
                }

                HStack {
                    Text("Review queue").font(.caption.bold()).foregroundStyle(.secondary)
                    Spacer()
                    if !model.reviewQueue.isEmpty {
                        Button("Clear all") { model.clearReviewQueue() }
                            .controlSize(.small)
                    }
                }
                if model.reviewQueue.isEmpty {
                    Text("Nothing flagged. Blocked flows, would-have-blocked flows, and watcher alerts land here.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(model.reviewQueue) { item in
                    HStack {
                        Image(systemName: "hand.raised.fill").font(.caption2).foregroundStyle(.red)
                        VStack(alignment: .leading, spacing: 1) {
                            Text("\(item.appName) → \(item.destination)").font(.caption)
                            Text(item.reason).font(.caption2).foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Text(item.at.formatted(date: .omitted, time: .shortened))
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                    .padding(6)
                    .background(.red.opacity(0.07), in: RoundedRectangle(cornerRadius: 5))
                }
            }
            .padding(16)
        }
    }
}

// MARK: - Watchers

struct WatchersSection: View {
    @ObservedObject var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Adjacent watchers (spec §9)")
                    .font(.caption.bold()).foregroundStyle(.secondary)

                if model.watcherEvents.isEmpty {
                    Text("No persistence, quarantine, or camera/mic events observed yet.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(model.watcherEvents) { event in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: event.kind.icon)
                            .foregroundStyle(event.kind.tint)
                            .font(.caption)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(event.title).font(.caption)
                            Text(event.detail).font(.caption2).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(event.at.formatted(date: .omitted, time: .shortened))
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                    .padding(8)
                    .background(.quaternary.opacity(0.2), in: RoundedRectangle(cornerRadius: 5))
                }
            }
            .padding(16)
        }
    }
}
