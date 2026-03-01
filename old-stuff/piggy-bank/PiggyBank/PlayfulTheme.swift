import SwiftUI

struct PlayfulTheme: Theme {
    // Colors - Soft pastel palette for kids
    var backgroundColor: Color = Color(red: 0.98, green: 0.98, blue: 1.0) // Very light lavender
    var cardBackgroundColor: Color = Color.white
    var primaryTextColor: Color = Color(red: 0.2, green: 0.2, blue: 0.3) // Soft dark blue
    var secondaryTextColor: Color = Color(red: 0.4, green: 0.4, blue: 0.5) // Muted gray
    var accentColor: Color = Color(red: 0.85, green: 0.65, blue: 0.98) // Playful purple
    var successColor: Color = Color(red: 0.2, green: 0.7, blue: 0.3) // Darker green for better contrast
    
    // Typography - Rounded, kid-friendly fonts
    var titleFont: Font = .system(size: 26, weight: .heavy, design: .rounded)
    var headlineFont: Font = .system(size: 22, weight: .bold, design: .rounded)
    var bodyFont: Font = .system(size: 16, weight: .medium, design: .rounded)
    var captionFont: Font = .system(size: 14, weight: .medium, design: .rounded)
    
    // Spacing & Layout - Touch-first, generous spacing
    var cardCornerRadius: CGFloat = 24
    var cardPadding: CGFloat = 24
    var itemSpacing: CGFloat = 16
    var sectionSpacing: CGFloat = 32
    
    // Visual Effects - Soft, playful shadows
    var shadowColor: Color = Color(red: 0.85, green: 0.65, blue: 0.98).opacity(0.2)
    var shadowRadius: CGFloat = 8
    var shadowOffset: CGSize = CGSize(width: 0, height: 4)
    
    // Animations - Bouncy, delightful timing
    var animationDuration: Double = 0.6
    var animationCurve: Animation = .spring(response: 0.6, dampingFraction: 0.7, blendDuration: 0)
}