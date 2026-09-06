import Foundation
import UserNotifications

/// Monitor-mode alerts (spec §7.4). UNUserNotificationCenter requires a real
/// app bundle; running bare (swift run) falls back to console lines so mock
/// verification still exercises the path.
final class Notifier {
    private let usesCenter: Bool

    init() {
        usesCenter = Bundle.main.bundleIdentifier != nil
        if usesCenter {
            UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
    }

    func notify(title: String, body: String) {
        if usesCenter {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            let request = UNNotificationRequest(identifier: UUID().uuidString,
                                                content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)
        } else {
            print("[gargoyle alert] \(title) — \(body)")
        }
    }
}
