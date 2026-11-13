import SwiftUI

struct SpeakerAvatarView: View {
    let name: String
    let known: [KnownSpeaker]
    @EnvironmentObject private var model: ContentViewModel

    var body: some View {
        if name == "Speaker ?" {
            // Provisional avatar: dashed circle with ?
            ZStack {
                Circle()
                    .stroke(style: StrokeStyle(lineWidth: 1, dash: [4,3]))
                    .foregroundColor(Color(UIColor.separator))
                Text("?")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color(UIColor.label).opacity(0.6))
            }
            .frame(width: 24, height: 24)
        } else {
            let match = known.first { fullName(of: $0) == name }
            if let m = match {
                avatar(symbol: m.avatarSymbol, colorHex: m.colorHex)
            } else {
                // Derive number from trailing digit in "Speaker N"
                let parts = name.split(separator: " ")
                let num = (parts.count >= 2 ? String(parts.last!) : "?")
                avatar(symbol: num, colorHex: SpeakerColors.colorHex(for: name))
            }
        }
    }

    func avatar(symbol: String, colorHex: String) -> some View {
        Text(symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(.white)
            .frame(width: 24, height: 24)
            .background(Circle().fill(Color(hex: colorHex)))
    }

    func fullName(of s: KnownSpeaker) -> String { (s.firstName + " " + s.lastName).trimmingCharacters(in: .whitespaces) }

    func resolvedColorHex(for key: String) -> String { SpeakerColors.colorHex(for: key) }
}

// MARK: - Color hex init
extension Color {
    init(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hexSanitized).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hexSanitized.count {
        case 6: (a, r, g, b) = (255, (int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff)
        case 8: (a, r, g, b) = ((int >> 24) & 0xff, (int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff)
        default: (a, r, g, b) = (255, 200, 200, 200)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: Double(a) / 255)
    }
}

