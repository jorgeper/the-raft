import SwiftUI

struct KidDetailView: View {
    let kid: Kid
    @Environment(\.theme) private var theme
    
    var body: some View {
        ScrollView {
            VStack(spacing: theme.sectionSpacing) {
                // Header Section - Avatar, Name, Balance
                headerSection
                
                // Action Buttons Section
                actionButtonsSection
                
                // Transaction History Section
                transactionHistorySection
            }
            .padding(theme.cardPadding)
        }
        .background(theme.backgroundColor)
        .navigationBarTitleDisplayMode(.inline)
    }
    
    // MARK: - Header Section
    private var headerSection: some View {
        HStack(spacing: theme.itemSpacing) {
            AvatarView(name: kid.name, imageName: kid.avatarImageName, size: 80)
            
            Text(kid.name)
                .font(theme.headlineFont)
                .foregroundColor(theme.primaryTextColor)
            
            Spacer()
            
            Text("$\(kid.balance, specifier: "%.2f")")
                .font(theme.titleFont)
                .fontWeight(.heavy)
                .foregroundColor(theme.successColor)
        }
        .padding(theme.cardPadding)
        .background(theme.cardBackgroundColor)
        .cornerRadius(theme.cardCornerRadius)
        .shadow(color: theme.shadowColor, radius: theme.shadowRadius, x: theme.shadowOffset.width, y: theme.shadowOffset.height)
    }
    
    // MARK: - Action Buttons Section
    private var actionButtonsSection: some View {
        HStack(spacing: theme.itemSpacing) {
            Button(action: {
                // TODO: Add money functionality
            }) {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 24))
                    Text("Add Money")
                        .font(theme.headlineFont)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(theme.successColor)
                .cornerRadius(theme.cardCornerRadius)
            }
            
            Button(action: {
                // TODO: Withdraw money functionality
            }) {
                HStack(spacing: 8) {
                    Image(systemName: "minus.circle.fill")
                        .font(.system(size: 24))
                    Text("Withdraw")
                        .font(theme.headlineFont)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(Color.red)
                .cornerRadius(theme.cardCornerRadius)
            }
        }
    }
    
    // MARK: - Transaction History Section
    private var transactionHistorySection: some View {
        VStack(alignment: .leading, spacing: theme.itemSpacing) {
            Text("Recent Transactions")
                .font(theme.headlineFont)
                .foregroundColor(theme.primaryTextColor)
                .padding(.horizontal, theme.itemSpacing)
            
            LazyVStack(spacing: theme.itemSpacing / 2) {
                ForEach(kid.transactions.sorted(by: { $0.date > $1.date })) { transaction in
                    TransactionRowView(transaction: transaction)
                }
            }
        }
    }
}

// MARK: - Transaction Row View
struct TransactionRowView: View {
    let transaction: Transaction
    @Environment(\.theme) private var theme
    
    var body: some View {
        HStack(spacing: theme.itemSpacing) {
            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.description)
                    .font(theme.bodyFont)
                    .foregroundColor(theme.primaryTextColor)
                
                Text(transaction.formattedDate)
                    .font(theme.captionFont)
                    .foregroundColor(theme.secondaryTextColor)
            }
            
            Spacer()
            
            Text(transaction.formattedAmount)
                .font(theme.headlineFont)
                .fontWeight(.semibold)
                .foregroundColor(transaction.type == .deposit ? theme.successColor : Color.red)
        }
        .padding(theme.itemSpacing)
        .background(theme.cardBackgroundColor)
        .cornerRadius(theme.cardCornerRadius / 2)
        .shadow(color: theme.shadowColor.opacity(0.5), radius: theme.shadowRadius / 2, x: 0, y: 1)
    }
}

#Preview {
    NavigationView {
        KidDetailView(kid: Kid(
            id: UUID(),
            name: "Xabi",
            balance: 47.25,
            avatarImageName: "TestData/xabi-avatar",
            transactions: [
                Transaction(
                    id: UUID(),
                    date: Date(),
                    amount: 20.00,
                    description: "Birthday money from grandma",
                    type: .deposit
                ),
                Transaction(
                    id: UUID(),
                    date: Calendar.current.date(byAdding: .day, value: -2, to: Date()) ?? Date(),
                    amount: 5.00,
                    description: "Toy car purchase",
                    type: .withdrawal
                )
            ]
        ))
    }
    .environment(\.theme, PlayfulTheme())
}