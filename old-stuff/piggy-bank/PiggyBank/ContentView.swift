//
//  ContentView.swift
//  PiggyBank
//
//  Created by Jorge Pereira on 7/10/25.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var themeManager = ThemeManager()
    
    var body: some View {
        PiggyBankListView()
            .environment(\.theme, themeManager.currentTheme)
    }
}

#Preview {
    ContentView()
}
