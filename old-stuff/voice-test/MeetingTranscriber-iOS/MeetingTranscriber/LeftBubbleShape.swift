import SwiftUI

struct LeftBubbleShape: Shape {
    let cornerRadius: CGFloat
    let tailSize: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let r = cornerRadius
        let tail = tailSize

        // Bubble rect (body)
        let bubble = CGRect(x: rect.minX + tail, y: rect.minY, width: rect.width - tail, height: rect.height)

        // Key points
        let x0 = bubble.minX
        let y0 = bubble.minY
        let x1 = bubble.maxX
        let y1 = bubble.maxY

        // Start at top-left corner arc start
        path.move(to: CGPoint(x: x0 + r, y: y0))
        // Top edge to top-right arc
        path.addLine(to: CGPoint(x: x1 - r, y: y0))
        path.addQuadCurve(to: CGPoint(x: x1, y: y0 + r), control: CGPoint(x: x1, y: y0))
        // Right edge to bottom-right arc
        path.addLine(to: CGPoint(x: x1, y: y1 - r))
        path.addQuadCurve(to: CGPoint(x: x1 - r, y: y1), control: CGPoint(x: x1, y: y1))
        // Bottom edge toward left, stop near bottom-left to draw custom tail
        let bottomToTailStart = CGPoint(x: x0 + r * 0.85, y: y1)
        path.addLine(to: bottomToTailStart)

        // Tail: iMessage-style small rounded nib at the lower-left corner
        // Geometry tuned to visually match iOS Messages
        let tip = CGPoint(x: rect.minX + tail * 0.20, y: y1 - tail * 0.45)
        let c1  = CGPoint(x: x0 + r * 0.35, y: y1)                // control from bottom edge
        let c2  = CGPoint(x: x0 + r * 0.05, y: y1 - tail * 0.9)   // control toward left edge
        let attach = CGPoint(x: x0, y: y1 - r * 0.85)             // attach on left edge above corner

        path.addCurve(to: tip, control1: c1, control2: c2)
        path.addQuadCurve(to: attach, control: CGPoint(x: x0, y: y1 - tail))

        // Left edge up to top-left arc
        path.addLine(to: CGPoint(x: x0, y: y0 + r))
        path.addQuadCurve(to: CGPoint(x: x0 + r, y: y0), control: CGPoint(x: x0, y: y0))

        path.closeSubpath()

        return path
    }
}

