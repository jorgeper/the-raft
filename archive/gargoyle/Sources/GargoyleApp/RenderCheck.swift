import SwiftUI
import AppKit
import GargoyleCore

/// Verification hook: GARGOYLE_RENDER=<dir> renders the visual surfaces
/// offscreen with ImageRenderer and exits. This exercises the real Canvas and
/// Chart drawing code without a display, so the views can be checked in a
/// headless run — a launch that "didn't crash" proves much less.
@MainActor
enum RenderCheck {
    static func runIfRequested(model: AppModel) {
        guard let directory = ProcessInfo.processInfo.environment["GARGOYLE_RENDER"] else { return }

        // Give the mock tap time to produce and finalize some flows.
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
            let apps = (try? model.store.appRollups(since: Date().addingTimeInterval(-86400))) ?? []
            guard let app = apps.first else {
                fputs("[render] no apps recorded — nothing to draw\n", stderr)
                NSApp.terminate(nil)
                return
            }
            fputs("[render] apps: \(apps.map { "\($0.displayName)(\($0.destinationCount) dests, \($0.totalBytes)B)" }.joined(separator: ", "))\n", stderr)

            render(ConstellationView(model: model, app: app)
                    .frame(width: 900, height: 620),
                   to: directory + "/constellation.png")

            // ImageRenderer can rasterize drawing-level views (Canvas, shapes,
            // charts) but not NavigationSplitView/ScrollView containers or
            // AppKit controls, so render the heatmap itself rather than the
            // window that hosts it.
            let grid = (try? model.store.activityHeatmap(
                processLabel: app.processLabel,
                since: Date().addingTimeInterval(-7 * 86400))) ?? []
            let busiest = grid.flatMap { $0 }.max() ?? 0
            fputs("[render] heatmap peak cell: \(busiest) bytes\n", stderr)
            render(HeatmapGrid(grid: grid).padding(20).background(Color.white),
                   to: directory + "/heatmap.png")
            NSApp.terminate(nil)
        }
    }

    private static func render(_ view: some View, to path: String) {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let png = bitmap.representation(using: .png, properties: [:]) else {
            fputs("[render] FAILED to render \(path)\n", stderr)
            return
        }
        do {
            try png.write(to: URL(fileURLWithPath: path))
            fputs("[render] wrote \(path) (\(png.count) bytes)\n", stderr)
        } catch {
            fputs("[render] write failed \(path): \(error)\n", stderr)
        }
    }
}
