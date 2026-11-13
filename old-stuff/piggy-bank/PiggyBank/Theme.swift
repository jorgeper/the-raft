import SwiftUI

protocol Theme {
    // Colors
    var backgroundColor: Color { get }
    var cardBackgroundColor: Color { get }
    var primaryTextColor: Color { get }
    var secondaryTextColor: Color { get }
    var accentColor: Color { get }
    var successColor: Color { get }
    
    // Typography
    var titleFont: Font { get }
    var headlineFont: Font { get }
    var bodyFont: Font { get }
    var captionFont: Font { get }
    
    // Spacing & Layout
    var cardCornerRadius: CGFloat { get }
    var cardPadding: CGFloat { get }
    var itemSpacing: CGFloat { get }
    var sectionSpacing: CGFloat { get }
    
    // Visual Effects
    var shadowColor: Color { get }
    var shadowRadius: CGFloat { get }
    var shadowOffset: CGSize { get }
    
    // Animations
    var animationDuration: Double { get }
    var animationCurve: Animation { get }
}