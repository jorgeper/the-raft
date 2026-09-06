import SwiftUI
import GargoyleCore

/// The "cool visual" (spec §7.2): the app at the center, destinations as nodes
/// on orbital rings by heuristics category, sized by cumulative bytes, with
/// pulses travelling the edges of live flows. A scrubber replays any window
/// from the audit log.
struct ConstellationView: View {
    @ObservedObject var model: AppModel
    let app: AppRollup

    @State private var nodes: [DestinationNode] = []
    @State private var selected: DestinationNode?
    @State private var hovered: DestinationNode?
    @State private var windowHours: Double = 1
    /// Scrub offset in hours back from now; 0 = live.
    @State private var scrub: Double = 0
    @State private var loadFailed = false

    private var isLive: Bool { scrub == 0 }

    private var windowEnd: Date {
        Date().addingTimeInterval(-scrub * 3600)
    }

    private var windowStart: Date {
        windowEnd.addingTimeInterval(-windowHours * 3600)
    }

    var body: some View {
        VStack(spacing: 0) {
            canvas
            inspectorOrLegend
            scrubber
        }
        .background(Color(nsColor: .underPageBackgroundColor))
        .onAppear(perform: reload)
        .onChange(of: scrub) { _, _ in reload() }
        .onChange(of: windowHours) { _, _ in reload() }
        .onChange(of: app.processLabel) { _, _ in
            selected = nil
            reload()
        }
        .onReceive(model.tick) { _ in
            if isLive { reload() }
        }
    }

    // MARK: - Canvas

    private var canvas: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                let maxRadius = min(size.width, size.height) / 2 - 60
                let placements = layout(nodes: nodes, center: center, maxRadius: maxRadius)

                drawRings(in: context, center: center, maxRadius: maxRadius)
                for placement in placements {
                    drawEdge(in: context, from: center, to: placement, time: t)
                }
                for placement in placements {
                    drawNode(in: context, placement: placement, time: t)
                }
                drawCenter(in: context, at: center)
            }
            .onContinuousHover { phase in
                guard case .active(let point) = phase else {
                    hovered = nil
                    return
                }
                hovered = node(at: point)
            }
            .onTapGesture { location in
                if let node = node(at: location) { selected = node }
            }
            .overlay(alignment: .topLeading) { statusOverlay }
            .overlay(alignment: .topTrailing) { hoverTooltip }
        }
        .frame(minHeight: 380)
    }

    /// Nodes sit on the ring their category dictates, spread evenly around it.
    private struct Placement {
        let node: DestinationNode
        let point: CGPoint
        let radius: CGFloat
        let ringRadius: CGFloat
    }

    private func layout(nodes: [DestinationNode], center: CGPoint, maxRadius: CGFloat) -> [Placement] {
        guard !nodes.isEmpty, maxRadius > 0 else { return [] }
        let maxBytes = nodes.map(\.totalBytes).max() ?? 1
        let ringCount = 5
        var byRing: [Int: [DestinationNode]] = [:]
        for node in nodes {
            byRing[node.category.ring, default: []].append(node)
        }

        var placements: [Placement] = []
        for (ring, ringNodes) in byRing {
            let ringRadius = Self.ringRadius(ring: ring, maxRadius: maxRadius)
            for (index, node) in ringNodes.enumerated() {
                // Offset each ring so nodes don't line up in spokes.
                let angle = 2 * .pi * CGFloat(index) / CGFloat(ringNodes.count)
                    + CGFloat(ring) * 0.6
                let point = CGPoint(x: center.x + cos(angle) * ringRadius,
                                    y: center.y + sin(angle) * ringRadius)
                // Node size = cumulative bytes (sqrt so a whale doesn't eclipse the rest).
                let scale = sqrt(Double(node.totalBytes) / Double(max(maxBytes, 1)))
                let radius = 5 + CGFloat(scale) * 16
                placements.append(Placement(node: node, point: point,
                                            radius: radius, ringRadius: ringRadius))
            }
        }
        return placements
    }

    /// The innermost ring must clear the center node plus the largest possible
    /// destination node, or they collide.
    static func ringRadius(ring: Int, maxRadius: CGFloat) -> CGFloat {
        let innermost: CGFloat = 78
        guard maxRadius > innermost else { return maxRadius }
        return innermost + (maxRadius - innermost) * CGFloat(ring) / 4
    }

    private func drawRings(in context: GraphicsContext, center: CGPoint, maxRadius: CGFloat) {
        for ring in 0..<5 {
            let radius = Self.ringRadius(ring: ring, maxRadius: maxRadius)
            let rect = CGRect(x: center.x - radius, y: center.y - radius,
                              width: radius * 2, height: radius * 2)
            // The outer (unknown) ring is drawn hotter — it's the one to look at.
            let color: Color = ring == 4 ? .orange.opacity(0.22) : .gray.opacity(0.12)
            context.stroke(Path(ellipseIn: rect), with: .color(color),
                           style: StrokeStyle(lineWidth: 1, dash: ring == 4 ? [4, 4] : []))
        }
    }

    private func drawEdge(in context: GraphicsContext, from center: CGPoint,
                          to placement: Placement, time: TimeInterval) {
        var path = Path()
        path.move(to: center)
        path.addLine(to: placement.point)

        let node = placement.node
        let live = model.liveDestinations.contains(node.destination)
        let thickness: CGFloat = live ? 1.8 : 0.8
        context.stroke(path, with: .color(color(for: node).opacity(live ? 0.5 : 0.22)),
                       style: StrokeStyle(lineWidth: thickness))

        // A live flow sends a pulse travelling outward along its edge.
        guard live, isLive else { return }
        let phase = (time * 0.6).truncatingRemainder(dividingBy: 1)
        let pulse = CGPoint(x: center.x + (placement.point.x - center.x) * phase,
                            y: center.y + (placement.point.y - center.y) * phase)
        let dot = CGRect(x: pulse.x - 3, y: pulse.y - 3, width: 6, height: 6)
        context.fill(Path(ellipseIn: dot),
                     with: .color(color(for: node).opacity(1 - phase * 0.7)))
    }

    private func drawNode(in context: GraphicsContext, placement: Placement, time: TimeInterval) {
        let node = placement.node
        let rect = CGRect(x: placement.point.x - placement.radius,
                          y: placement.point.y - placement.radius,
                          width: placement.radius * 2, height: placement.radius * 2)
        let base = color(for: node)

        if selected?.id == node.id || hovered?.id == node.id {
            let halo = rect.insetBy(dx: -5, dy: -5)
            context.fill(Path(ellipseIn: halo), with: .color(base.opacity(0.25)))
        }
        context.fill(Path(ellipseIn: rect), with: .color(base.opacity(0.85)))
        context.stroke(Path(ellipseIn: rect), with: .color(base), lineWidth: 1)

        let label = Text(node.destination)
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
        context.draw(label, at: CGPoint(x: placement.point.x,
                                        y: placement.point.y + placement.radius + 8))
    }

    private func drawCenter(in context: GraphicsContext, at center: CGPoint) {
        let rect = CGRect(x: center.x - 22, y: center.y - 22, width: 44, height: 44)
        context.fill(Path(ellipseIn: rect), with: .color(.accentColor.opacity(0.22)))
        context.stroke(Path(ellipseIn: rect), with: .color(.accentColor), lineWidth: 1.5)
        context.draw(Text(app.displayName).font(.system(size: 11, weight: .semibold)),
                     at: CGPoint(x: center.x, y: center.y + 34))
    }

    /// Verdict state drives node color (spec §7.2): green allowed, amber
    /// alerted, red blocked/would-have-blocked.
    private func color(for node: DestinationNode) -> Color {
        if node.everBlocked { return .red }
        if node.category == .unknown { return .orange }
        if node.everAlerted { return .yellow }
        return .green
    }

    private func node(at point: CGPoint) -> DestinationNode? {
        // Recomputing the layout for hit-testing keeps the Canvas closure pure;
        // the node count here is small (tens), so this is cheap.
        let size = lastCanvasSize
        guard size.width > 0 else { return nil }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let maxRadius = min(size.width, size.height) / 2 - 60
        return layout(nodes: nodes, center: center, maxRadius: maxRadius)
            .first { placement in
                hypot(placement.point.x - point.x, placement.point.y - point.y)
                    <= max(placement.radius, 10)
            }?.node
    }

    @State private var lastCanvasSize: CGSize = .zero

    // MARK: - Overlays

    private var statusOverlay: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(app.displayName).font(.headline)
            Text(isLive ? "live · last \(Int(windowHours))h"
                        : "replay · \(Int(scrub))h ago, \(Int(windowHours))h window")
                .font(.caption)
                .foregroundStyle(isLive ? Color.secondary : Color.orange)
            if nodes.isEmpty {
                Text(loadFailed ? "could not read the audit log"
                                : "no destinations in this window")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .padding(10)
        .background(GeometryReader { proxy in
            Color.clear
                .onAppear { lastCanvasSize = proxy.size }
                .onChange(of: proxy.size) { _, size in lastCanvasSize = size }
        })
    }

    @ViewBuilder
    private var hoverTooltip: some View {
        if let node = hovered {
            VStack(alignment: .leading, spacing: 2) {
                Text(node.destination).font(.caption.bold())
                Text("\(node.service) · \(node.category.label)")
                    .font(.caption2).foregroundStyle(.secondary)
                Text("↑ \(Self.bytes(node.bytesOut))  ↓ \(Self.bytes(node.bytesIn))")
                    .font(.caption2.monospacedDigit())
                Text("last seen \(node.lastSeen.formatted(date: .omitted, time: .standard))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .padding(8)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
            .padding(10)
        }
    }

    // MARK: - Inspector

    @ViewBuilder
    private var inspectorOrLegend: some View {
        if let node = selected {
            InspectorPanel(node: node, app: app, model: model) { selected = nil }
        } else {
            legend
        }
    }

    private var legend: some View {
        HStack(spacing: 12) {
            ForEach(DestinationCategory.allCases, id: \.self) { category in
                HStack(spacing: 4) {
                    Circle()
                        .fill(category == .unknown ? Color.orange : Color.gray.opacity(0.5))
                        .frame(width: 6, height: 6)
                    Text(category.label).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("click a node to inspect").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    // MARK: - Scrubber

    private var scrubber: some View {
        VStack(spacing: 4) {
            Divider()
            HStack(spacing: 10) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.caption).foregroundStyle(.secondary)
                Slider(value: $scrub, in: 0...72, step: 1) {
                    Text("Replay")
                } minimumValueLabel: {
                    Text("now").font(.caption2)
                } maximumValueLabel: {
                    Text("-72h").font(.caption2)
                }
                Picker("", selection: $windowHours) {
                    Text("1h").tag(1.0)
                    Text("6h").tag(6.0)
                    Text("24h").tag(24.0)
                }
                .pickerStyle(.segmented)
                .frame(width: 130)
                .controlSize(.small)
                if !isLive {
                    Button("Live") { scrub = 0 }.controlSize(.small)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
    }

    // MARK: - Data

    private func reload() {
        do {
            nodes = try model.store.destinationNodes(
                processLabel: app.processLabel,
                since: windowStart, until: windowEnd,
                heuristics: model.heuristics)
            loadFailed = false
        } catch {
            nodes = []
            loadFailed = true
        }
    }

    static func bytes(_ count: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        return formatter.string(fromByteCount: Int64(count))
    }
}

/// Slides in on node click: full metadata plus pre-filled rule buttons
/// ("block this domain for this app").
struct InspectorPanel: View {
    let node: DestinationNode
    let app: AppRollup
    @ObservedObject var model: AppModel
    let onClose: () -> Void

    private var domainRule: Destination {
        let parts = node.destination.split(separator: ".")
        if parts.count > 2, node.destination != node.ip {
            return .suffix(parts.suffix(2).joined(separator: "."))
        }
        return node.destination == node.ip ? .ip(node.ip) : .host(node.destination)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(node.destination).font(.headline)
                Spacer()
                Button {
                    onClose()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.plain)
            }

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 3) {
                GridRow {
                    Text("Service").font(.caption).foregroundStyle(.secondary)
                    Text("\(node.service) · \(node.category.label)")
                        .font(.caption)
                        .foregroundStyle(node.category == .unknown ? .orange : .primary)
                }
                GridRow {
                    Text("Address").font(.caption).foregroundStyle(.secondary)
                    Text("\(node.ip):\(node.port)").font(.caption.monospaced())
                }
                GridRow {
                    Text("Volume").font(.caption).foregroundStyle(.secondary)
                    Text("↑ \(ConstellationView.bytes(node.bytesOut))  ↓ \(ConstellationView.bytes(node.bytesIn))  ·  \(node.flowCount) flows")
                        .font(.caption.monospacedDigit())
                }
                GridRow {
                    Text("Seen").font(.caption).foregroundStyle(.secondary)
                    Text("\(node.firstSeen.formatted(date: .abbreviated, time: .shortened)) → \(node.lastSeen.formatted(date: .omitted, time: .standard))")
                        .font(.caption)
                }
            }

            HStack(spacing: 6) {
                Button("Block \(domainRule.displayString) for \(app.displayName)") {
                    model.addRule(action: .block, destination: domainRule, appLabel: app.processLabel)
                }
                .controlSize(.small)
                .tint(.red)

                Button("Allow always") {
                    model.addRule(action: .allow, destination: domainRule, appLabel: app.processLabel)
                }
                .controlSize(.small)

                if node.category == .unknown {
                    Button("Look up") {
                        // Manual research, user-initiated (spec §8): Gargoyle
                        // itself never phones home about a destination.
                        if let url = URL(string: "https://www.google.com/search?q=\(node.destination)") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    .controlSize(.small)
                }
                Spacer()
            }
        }
        .padding(12)
        .background(.quaternary.opacity(0.35))
    }
}
