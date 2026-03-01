import Foundation
import SwiftUI

struct Conversation: Identifiable, Codable, Equatable {
    let id: UUID
    var title: String
    var lastSnippet: String
    var date: Date
    var participants: [String]
}

final class ConversationsStore: ObservableObject {
    @Published var items: [Conversation] = [] {
        didSet { persist() }
    }

    private let storageKey = "conversations_store_items"

    init() { load() }

    func createNewConversation() -> Conversation {
        let c = Conversation(id: UUID(), title: "New Conversation", lastSnippet: "", date: Date(), participants: [])
        items.insert(c, at: 0)
        return c
    }

    func updateConversation(id: UUID, snippet: String?, participants: [String]?) {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        var c = items[idx]
        if let s = snippet, !s.isEmpty { c.lastSnippet = s; c.title = inferredTitle(from: c) }
        // Avoid wiping participants when we cannot confidently infer them
        if let p = participants, !p.isEmpty { c.participants = p }
        c.date = Date()
        items[idx] = c
    }

    private func inferredTitle(from c: Conversation) -> String {
        if !c.participants.isEmpty { return c.participants.joined(separator: ", ") }
        if !c.lastSnippet.isEmpty { return String(c.lastSnippet.prefix(32)) }
        // Default to timestamp if no better title
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short
        return f.string(from: c.date)
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(items) { UserDefaults.standard.set(data, forKey: storageKey) }
    }

    private func load() {
        if let data = UserDefaults.standard.data(forKey: storageKey), let decoded = try? JSONDecoder().decode([Conversation].self, from: data) {
            items = decoded
        } else {
            // Also load any JSON files from Documents to seed list
            let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            if let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
                let iso = ISO8601DateFormatter()
                for url in files where url.pathExtension == "json" {
                    if let data = try? Data(contentsOf: url), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        let idStr = obj["id"] as? String ?? UUID().uuidString
                        let dt = (obj["date"] as? String).flatMap { iso.date(from: $0) } ?? Date()
                        let participants = obj["participants"] as? [String] ?? []
                        let messages = obj["messages"] as? [[String: Any]] ?? []
                        let last = messages.last? ["text"] as? String ?? ""
                        items.append(Conversation(id: UUID(uuidString: idStr) ?? UUID(), title: participants.joined(separator: ", "), lastSnippet: last, date: dt, participants: participants))
                    }
                }
            }
        }
    }
}

