import SwiftUI

struct AvatarView: View {
    let name: String
    let imageName: String
    let size: CGFloat
    @Environment(\.theme) private var theme
    
    private let pastelColors: [Color] = [
        Color(red: 0.98, green: 0.75, blue: 0.75), // Pastel Pink
        Color(red: 0.75, green: 0.85, blue: 0.98), // Pastel Blue
        Color(red: 0.98, green: 0.85, blue: 0.75), // Pastel Peach
        Color(red: 0.85, green: 0.75, blue: 0.98), // Pastel Purple
        Color(red: 0.75, green: 0.98, blue: 0.85), // Pastel Mint
        Color(red: 0.98, green: 0.98, blue: 0.75), // Pastel Yellow
        Color(red: 0.75, green: 0.98, blue: 0.98), // Pastel Cyan
        Color(red: 0.98, green: 0.75, blue: 0.85), // Pastel Rose
    ]
    
    private var backgroundColor: Color {
        let index = abs(name.hashValue) % pastelColors.count
        return pastelColors[index]
    }
    
    private var initial: String {
        String(name.prefix(1)).uppercased()
    }
    
    var body: some View {
        if UIImage(named: imageName) != nil {
            Image(imageName)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(Circle())
                .shadow(color: theme.shadowColor, radius: theme.shadowRadius * 0.5, x: 0, y: 2)
        } else {
            ZStack {
                Circle()
                    .fill(backgroundColor)
                    .frame(width: size, height: size)
                    .shadow(color: theme.shadowColor, radius: theme.shadowRadius * 0.5, x: 0, y: 2)
                
                Text(initial)
                    .font(.system(size: size * 0.4, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
            }
        }
    }
}

struct AvatarView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 20) {
            AvatarView(name: "Xabi", imageName: "TestData/xabi-avatar", size: 60)
            AvatarView(name: "Yago", imageName: "TestData/yago-avatar", size: 60)
            AvatarView(name: "Carmen", imageName: "TestData/carmen-avatar", size: 60)
        }
        .padding()
        .previewLayout(.sizeThatFits)
    }
}