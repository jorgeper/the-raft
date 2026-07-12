import SwiftUI
import AppKit
import GargoyleCore

/// Firewall approval prompt (spec §5). A dedicated always-on-top window, not a
/// popover: the decision gates traffic (Tap A) and must not be dismissed by a
/// stray click.
@MainActor
final class ApprovalWindowController {
    private var window: NSWindow?
    private weak var model: AppModel?

    init(model: AppModel) {
        self.model = model
    }

    func present(_ approval: PendingApproval) {
        guard let model else { return }
        if window != nil { return }   // one prompt at a time; the rest queue

        let view = ApprovalView(approval: approval, model: model) { [weak self] in
            self?.dismiss()
        }
        let hosting = NSHostingController(rootView: view)
        let window = NSWindow(contentViewController: hosting)
        window.title = "Gargoyle — Approval"
        window.styleMask = [.titled]
        window.level = .floating
        window.isReleasedWhenClosed = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    func dismiss() {
        window?.close()
        window = nil
        // Show the next queued approval, if any.
        if let next = model?.pendingApprovals.first {
            present(next)
        }
    }
}

struct ApprovalView: View {
    let approval: PendingApproval
    @ObservedObject var model: AppModel
    let onDone: () -> Void

    private var suffixDestination: Destination? {
        guard let host = approval.context.host else { return nil }
        let parts = host.split(separator: ".")
        guard parts.count > 2 else { return nil }
        return .suffix(parts.suffix(2).joined(separator: "."))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "shield.lefthalf.filled")
                    .font(.system(size: 26))
                    .foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(approval.flow.displayName).font(.headline)
                    Text(approval.flow.processLabel)
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 4) {
                GridRow {
                    Text("Destination").font(.caption).foregroundStyle(.secondary)
                    Text(approval.context.destinationLabel).font(.caption.monospaced())
                }
                GridRow {
                    Text("Address").font(.caption).foregroundStyle(.secondary)
                    Text("\(approval.context.ip):\(approval.context.port)")
                        .font(.caption.monospaced())
                }
                GridRow {
                    Text("Classification").font(.caption).foregroundStyle(.secondary)
                    // Heuristics DB arrives in Phase 3; until then, honest "Unknown".
                    Text("Unknown").font(.caption).foregroundStyle(.orange)
                }
            }

            if approval.retrospective {
                Label("Monitor-only tap: this connection already happened and was not blocked.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Text("Allow").font(.caption.bold()).foregroundStyle(.secondary)
                HStack {
                    Button("Once") { resolve(.allow, .once) }
                    Button("Until quit") { resolve(.allow, .untilQuit) }
                    Button("Always") { resolve(.allow, .persistent) }
                    if let suffix = suffixDestination {
                        Button("Always \(suffix.displayString)") {
                            resolve(.allow, .persistent, suffix)
                        }
                    }
                }
                Text("Block").font(.caption.bold()).foregroundStyle(.secondary)
                HStack {
                    Button("Once") { resolve(.block, .once) }
                    Button("Always") { resolve(.block, .persistent) }
                        .tint(.red)
                }
            }
        }
        .padding(18)
        .frame(width: 420)
    }

    private func resolve(_ action: RuleAction, _ scope: RuleScope, _ destination: Destination? = nil) {
        model.resolveApproval(approval, action: action, scope: scope, destination: destination)
        onDone()
    }
}
