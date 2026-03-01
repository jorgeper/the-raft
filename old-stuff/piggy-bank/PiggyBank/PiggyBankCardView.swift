import SwiftUI

struct PiggyBankCardView: View {
    let kid: Kid
    @Environment(\.theme) private var theme
    
    var body: some View {
        NavigationLink(destination: KidDetailView(kid: kid)) {
            HStack(spacing: theme.itemSpacing) {
                AvatarView(name: kid.name, imageName: kid.avatarImageName, size: 60)
                
                Text(kid.name)
                    .font(theme.headlineFont)
                    .foregroundColor(theme.primaryTextColor)
                
                Spacer()
                
                Text("$\(kid.balance, specifier: "%.2f")")
                    .font(theme.titleFont)
                    .fontWeight(.heavy)
                    .foregroundColor(theme.successColor)
            }
        }
        .buttonStyle(PlainButtonStyle())
        .padding(theme.cardPadding)
        .background(theme.cardBackgroundColor)
        .cornerRadius(theme.cardCornerRadius)
        .shadow(color: theme.shadowColor, radius: theme.shadowRadius, x: theme.shadowOffset.width, y: theme.shadowOffset.height)
    }
}

struct PiggyBankCardView_Previews: PreviewProvider {
    static var previews: some View {
        PiggyBankCardView(kid: Kid(
            id: UUID(),
            name: "Test Kid",
            balance: 25.50,
            avatarImageName: "TestData/xabi-avatar",
            transactions: []
        ))
        .padding()
        .previewLayout(.sizeThatFits)
    }
}