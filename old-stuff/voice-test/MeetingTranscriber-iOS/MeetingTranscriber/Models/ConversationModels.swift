import Foundation

struct TranscriptLine: Identifiable, Equatable {
    let id: UUID = UUID()
    var speaker: String
    var text: String
    let timestamp: Date
}

struct KnownSpeaker: Identifiable, Equatable, Codable {
    let id: UUID
    var firstName: String
    var lastName: String
    var avatarSymbol: String   // use emoji short string for now
    var colorHex: String       // background color

    init(id: UUID = UUID(), firstName: String, lastName: String, avatarSymbol: String = "🙂", colorHex: String = "#D1D5DB") {
        self.id = id
        self.firstName = firstName
        self.lastName = lastName
        self.avatarSymbol = avatarSymbol
        self.colorHex = colorHex
    }

    var initials: String {
        let f = firstName.first.map(String.init) ?? ""
        let l = lastName.first.map(String.init) ?? ""
        return f + l
    }
}

