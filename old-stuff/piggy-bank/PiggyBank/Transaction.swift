import Foundation

struct Transaction: Identifiable, Codable {
    let id: UUID
    let date: Date
    let amount: Double
    let description: String
    let type: TransactionType
    
    enum TransactionType: String, Codable, CaseIterable {
        case deposit = "deposit"
        case withdrawal = "withdrawal"
    }
}

extension Transaction {
    var formattedAmount: String {
        let prefix = type == .deposit ? "+" : "-"
        return String(format: "\(prefix)$%.2f", abs(amount))
    }
    
    var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}