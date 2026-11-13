import Foundation

struct Kid: Identifiable, Codable {
    let id: UUID
    let name: String
    let balance: Double
    let avatarImageName: String
    let transactions: [Transaction]
}