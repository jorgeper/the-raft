import SwiftUI

class ThemeManager: ObservableObject {
    // MARK: - Theme Selection
    // Change this line to switch themes:
    @Published var currentTheme: Theme = PlayfulTheme() // or ClassicTheme()
}

// MARK: - Environment Key
struct ThemeKey: EnvironmentKey {
    static let defaultValue: Theme = PlayfulTheme() // Match the theme above
}

extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}