import SwiftUI

struct ClassicTheme: Theme {
    // Colors - Standard iOS appearance
    var backgroundColor: Color = Color(.systemGroupedBackground)
    var cardBackgroundColor: Color = Color(.systemBackground)
    var primaryTextColor: Color = Color(.label)
    var secondaryTextColor: Color = Color(.secondaryLabel)
    var accentColor: Color = Color(.systemBlue)
    var successColor: Color = Color(.systemGreen)
    
    // Typography - Standard SF fonts
    var titleFont: Font = .largeTitle.weight(.bold)
    var headlineFont: Font = .headline
    var bodyFont: Font = .body
    var captionFont: Font = .caption
    
    // Spacing & Layout - Current iOS conventions
    var cardCornerRadius: CGFloat = 12
    var cardPadding: CGFloat = 16
    var itemSpacing: CGFloat = 12
    var sectionSpacing: CGFloat = 20
    
    // Visual Effects - Subtle iOS shadows
    var shadowColor: Color = Color.black.opacity(0.1)
    var shadowRadius: CGFloat = 4
    var shadowOffset: CGSize = CGSize(width: 0, height: 2)
    
    // Animations - Standard iOS timing
    var animationDuration: Double = 0.3
    var animationCurve: Animation = .easeInOut(duration: 0.3)
}