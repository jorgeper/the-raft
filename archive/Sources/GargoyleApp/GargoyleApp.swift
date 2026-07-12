import SwiftUI
import AppKit

@main
struct GargoyleMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model: AppModel

    init() {
        let model = AppModel()
        _model = StateObject(wrappedValue: model)
        // The popover only builds on click, so hand the delegate the model here
        // — the headless verification hooks need it at launch.
        AppDelegate.model = model
    }

    var body: some Scene {
        MenuBarExtra {
            PopoverView(model: model)
        } label: {
            Image(systemName: model.tapConnected ? "shield.lefthalf.filled" : "shield.slash")
        }
        .menuBarExtraStyle(.window)

        Window("Gargoyle", id: "main") {
            MainWindow(model: model)
        }
        .defaultSize(width: 1000, height: 680)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Set by the App so verification hooks can reach the live model.
    @MainActor static var model: AppModel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let model = AppDelegate.model {
            RenderCheck.runIfRequested(model: model)
        }
        // Menu-bar app: no Dock icon, also when run bare via `swift run`.
        NSApp.setActivationPolicy(.accessory)

        // Verification hook: GARGOYLE_AUTOEXIT=<seconds> quits cleanly after a
        // bounded run so the app can be exercised from CI/CLI.
        if let secs = ProcessInfo.processInfo.environment["GARGOYLE_AUTOEXIT"].flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + secs) {
                NSApp.terminate(nil)
            }
        }

        // GARGOYLE_OPEN_MAIN opens the main window without a menu-bar click, so
        // the visual surfaces can be exercised (and screenshotted) headlessly.
        if ProcessInfo.processInfo.environment["GARGOYLE_OPEN_MAIN"] != nil {
            NSApp.setActivationPolicy(.regular)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                NSApp.activate(ignoringOtherApps: true)
                for window in NSApp.windows where window.title == "Gargoyle" {
                    window.makeKeyAndOrderFront(nil)
                }
            }
        }
    }
}
