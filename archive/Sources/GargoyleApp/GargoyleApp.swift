import SwiftUI
import AppKit

@main
struct GargoyleMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            PopoverView(model: model)
        } label: {
            Image(systemName: model.tapConnected ? "shield.lefthalf.filled" : "shield.slash")
        }
        .menuBarExtraStyle(.window)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menu-bar app: no Dock icon, also when run bare via `swift run`.
        NSApp.setActivationPolicy(.accessory)

        // Verification hook: GARGOYLE_AUTOEXIT=<seconds> quits cleanly after a
        // bounded run so the app can be exercised from CI/CLI.
        if let secs = ProcessInfo.processInfo.environment["GARGOYLE_AUTOEXIT"].flatMap(Double.init) {
            DispatchQueue.main.asyncAfter(deadline: .now() + secs) {
                NSApp.terminate(nil)
            }
        }
    }
}
