import SwiftUI
import Charts
import GargoyleCore

struct PopoverView: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            sparkline
            if !model.pendingApprovals.isEmpty {
                pendingSection
            }
            if model.learningRemaining > 0 || model.showDigest {
                learningSection
            }
            recentSection
            if model.showReview {
                reviewSection
            }
            if !model.topApps.isEmpty {
                topAppsSection
            }
            Divider()
            footer
        }
        .padding(12)
        .frame(width: 400)
    }

    // MARK: - Pending approvals (act inline, spec §7.1)

    private var pendingSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Pending approvals").font(.caption.bold()).foregroundStyle(.orange)
            ForEach(model.pendingApprovals) { approval in
                HStack(spacing: 6) {
                    Text(approval.flow.displayName).font(.caption).lineLimit(1)
                    Text(approval.context.destinationLabel)
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    Button("Allow") {
                        model.resolveApproval(approval, action: .allow, scope: .persistent)
                    }
                    .controlSize(.mini)
                    Button("Block") {
                        model.resolveApproval(approval, action: .block, scope: .persistent)
                    }
                    .controlSize(.mini)
                    .tint(.red)
                }
            }
        }
        .padding(6)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Review queue

    private var reviewSection: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Review queue").font(.caption.bold()).foregroundStyle(.secondary)
                Spacer()
                Button("Hide") { model.showReview = false }.controlSize(.mini)
            }
            if model.reviewQueue.isEmpty {
                Text("Nothing blocked or flagged yet.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(model.reviewQueue.prefix(10)) { item in
                VStack(alignment: .leading, spacing: 1) {
                    HStack {
                        Image(systemName: "hand.raised.fill")
                            .font(.caption2).foregroundStyle(.red)
                        Text(item.appName).font(.caption2)
                        Text(item.destination).font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                    }
                    Text(item.reason)
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(6)
        .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Header + sparkline

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Gargoyle").font(.headline)
                Circle()
                    .fill(model.tapConnected ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
                Text(model.tapConnected ? "monitoring" : "helper offline")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                if model.paused {
                    Text("paused").font(.caption).foregroundStyle(.orange)
                }
            }
            if model.monitorOnly {
                // Spec §3: be honest about what this tap can and cannot do.
                Label("Monitor-only — rules evaluate but cannot block",
                      systemImage: "eye")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var sparkline: some View {
        Chart(model.series) { sample in
            AreaMark(
                x: .value("t", -sample.secondsAgo),
                y: .value("out", sample.bytesOut)
            )
            .foregroundStyle(.linearGradient(
                colors: [.green.opacity(0.55), .green.opacity(0.05)],
                startPoint: .top, endPoint: .bottom))
            .interpolationMethod(.monotone)
            LineMark(
                x: .value("t", -sample.secondsAgo),
                y: .value("out", sample.bytesOut)
            )
            .foregroundStyle(.green)
            .lineStyle(StrokeStyle(lineWidth: 1.2))
            .interpolationMethod(.monotone)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .frame(height: 44)
        .overlay(alignment: .topTrailing) {
            Text(rateLabel)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
                .padding(.trailing, 2)
        }
    }

    private var rateLabel: String {
        let current = model.series.suffix(3).map(\.bytesOut).max() ?? 0
        return current == 0 ? "idle" : "\(Self.bytes(current))/s ↑"
    }

    // MARK: - Learning mode

    private var learningSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            if model.learningRemaining > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "graduationcap.fill").font(.caption)
                    Text("Learning baseline — \(Self.minutes(model.learningRemaining)) left")
                        .font(.caption)
                    Spacer()
                    Button("Digest") { model.loadDigest() }
                        .controlSize(.mini)
                    Button("End") { model.endLearningNow() }
                        .controlSize(.mini)
                }
                .padding(6)
                .background(.yellow.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
            }
            if model.showDigest {
                digestList
            }
        }
    }

    private var digestList: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Baseline digest").font(.caption.bold())
                Spacer()
                Button("Hide") { model.showDigest = false }.controlSize(.mini)
            }
            if model.digest.isEmpty {
                Text("No finalized flows recorded yet.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(Array(model.digest.prefix(12).enumerated()), id: \.offset) { _, entry in
                HStack {
                    Text(entry.app).font(.caption2)
                    Text(entry.destination).font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(entry.flows)×  \(Self.bytes(entry.bytes))")
                        .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            Text("Bulk rule creation arrives with the Phase 2 rules engine.")
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(6)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Recent flows

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Recent").font(.caption.bold()).foregroundStyle(.secondary)
            if model.visibleRecent.isEmpty {
                Text(model.tapConnected ? "No flows yet — generate some traffic."
                                        : "Waiting for the capture helper…")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.visibleRecent.prefix(10)) { entry in
                HStack(spacing: 6) {
                    Circle()
                        .fill(entry.closed ? Color.secondary.opacity(0.4) : Color.green)
                        .frame(width: 6, height: 6)
                    Text(entry.flow.displayName)
                        .font(.caption)
                        .lineLimit(1)
                        .frame(width: 110, alignment: .leading)
                    Text(entry.flow.destinationLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    Text(Self.bytes(entry.flow.bytesOut + entry.flow.bytesIn))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Top apps

    /// Top apps double as the quick per-app mode toggles (spec §7.1).
    private var topAppsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Top apps (session)").font(.caption.bold()).foregroundStyle(.secondary)
            ForEach(model.topApps, id: \.name) { app in
                HStack(spacing: 6) {
                    Text(app.name).font(.caption).lineLimit(1)
                    Spacer()
                    Text(Self.bytes(app.bytes))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                    if let flow = model.latestFlow(named: app.name) {
                        Picker("", selection: Binding(
                            get: { model.mode(for: flow) },
                            set: { model.setMode($0, for: flow) }
                        )) {
                            Text("Monitor").tag(AppMode.monitor)
                            Text("Firewall").tag(AppMode.firewall)
                            Text("Ignore").tag(AppMode.ignore)
                        }
                        .labelsHidden()
                        .controlSize(.mini)
                        .frame(width: 90)
                    }
                }
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "square.stack.3d.up").font(.caption2).foregroundStyle(.secondary)
                Picker("", selection: Binding(
                    get: { model.activeProfileID },
                    set: { model.activateProfile($0) }
                )) {
                    ForEach(model.profiles) { profile in
                        Text(profile.name).tag(profile.id)
                    }
                }
                .labelsHidden()
                .controlSize(.small)
                .frame(maxWidth: 140)

                Spacer()
                Button {
                    model.showReview.toggle()
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "hand.raised")
                        if !model.reviewQueue.isEmpty {
                            Text("\(model.reviewQueue.count)")
                        }
                    }
                }
                .controlSize(.small)
                .help("Review queue")
            }
            HStack {
                Button(model.paused ? "Resume" : "Pause") {
                    model.paused.toggle()
                }
                .controlSize(.small)
                Toggle("System apps", isOn: $model.showSystem)
                    .toggleStyle(.checkbox)
                    .controlSize(.small)
                    .font(.caption)
                Spacer()
                Button("Open") { openWindow(id: "main") }
                    .controlSize(.small)
                Button("Quit") { NSApp.terminate(nil) }
                    .controlSize(.small)
            }
        }
    }

    // MARK: - Formatting

    private static func bytes(_ count: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter.string(fromByteCount: Int64(count))
    }

    private static func minutes(_ interval: TimeInterval) -> String {
        interval >= 3600 ? String(format: "%.0fh %02.0fm", interval / 3600, (interval.truncatingRemainder(dividingBy: 3600)) / 60)
                         : String(format: "%.0fm", max(1, interval / 60))
    }
}
