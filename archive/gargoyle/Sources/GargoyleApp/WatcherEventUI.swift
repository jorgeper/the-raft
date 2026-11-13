import SwiftUI
import GargoyleCore

extension WatcherEvent.Kind {
    var icon: String {
        switch self {
        case .persistenceAdded, .persistenceChanged: return "arrow.triangle.2.circlepath.circle"
        case .quarantinedAppPhonedHome: return "arrow.down.app"
        case .cameraUsed: return "video"
        case .micUsed: return "mic"
        }
    }

    var tint: Color {
        switch self {
        case .persistenceAdded, .quarantinedAppPhonedHome: return .orange
        case .persistenceChanged: return .yellow
        case .cameraUsed, .micUsed: return .blue
        }
    }
}
