import SwiftUI

struct MainView: View {
    @StateObject private var store = ConversationsStore()
    @State private var showingConversation = false
    @State private var activeConversationId: UUID?
    @State private var preloadData: Data?
    @StateObject private var modelForColors = ContentViewModel()

    var body: some View {
        NavigationView {
            List {
                ForEach(store.items) { convo in
                    Button {
                        // Load JSON into model before presenting
                        let docsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                        let fileURL = docsURL.appendingPathComponent("\(convo.id.uuidString).json")
                        print("Looking for conversation file at: \(fileURL.path)")
                        
                        if let data = try? Data(contentsOf: fileURL) {
                            print("Found conversation file: \(data.count) bytes")
                            preloadData = data
                        } else {
                            print("Failed to load conversation file")
                            preloadData = nil
                        }
                        // Present only after preloadData is set to avoid nil passing
                        activeConversationId = convo.id
                    } label: {
                        ConversationRow(convo: convo, known: [])
                            .environmentObject(modelForColors)
                    }
                }
                .onDelete { store.items.remove(atOffsets: $0) }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: startNewConversation) {
                        Image(systemName: "square.and.pencil")
                    }
                }
            }
            .sheet(item: $activeConversationId, onDismiss: { preloadData = nil }) { id in
                // Capture current preload data at sheet creation to avoid race with later changes
                let data = preloadData
                ConversationContainerView(conversationId: id, store: store, preload: data)
                    .id(id) // ensure fresh state per conversation
            }
        }
    }

    private func startNewConversation() {
    let c = store.createNewConversation()
        preloadData = nil
        // Present via the item-bound sheet to avoid race conditions
        DispatchQueue.main.async { activeConversationId = c.id }
    }

    private func initials(from c: Conversation) -> String {
        if let first = c.participants.first, let f = first.first { return String(f) }
        return "?"
    }

    static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f
    }()
}

struct ConversationContainerView: View {
    let conversationId: UUID?
    @ObservedObject var store: ConversationsStore
    var preload: Data?
    @StateObject private var model = ContentViewModel()

    var body: some View {
        NavigationView {
            ContentView(onBack: { saveAndDismiss() })
                .environmentObject(model)
        }
        .onDisappear { saveIfNeeded() }
        .onAppear {
            // Reset and load conversation data
            model.transcriptItems.removeAll()
            model.clearDirty()
            if let data = preload, !data.isEmpty {
                print("Loading conversation data: \(data.count) bytes")
                model.importJSON(data)
                print("After import: \(model.transcriptItems.count) items")
            } else {
                print("No preload data for conversation")
            }
        }
        .navigationBarHidden(true)
    }

    @Environment(\ .dismiss) private var dismiss
    private func saveAndDismiss() {
        guard let id = conversationId, let data = model.exportJSON(conversationId: id) else { dismiss(); return }
        // Persist file to Documents
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("\(id.uuidString).json")
        try? data.write(to: url)
        store.updateConversation(id: id, snippet: model.lastSnippet(), participants: model.participantsList())
        model.clearDirty()
        dismiss()
    }

    private func saveIfNeeded() {
        guard model.isDirty, let id = conversationId, let data = model.exportJSON(conversationId: id) else { return }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("\(id.uuidString).json")
        try? data.write(to: url)
        store.updateConversation(id: id, snippet: model.lastSnippet(), participants: model.participantsList())
        model.clearDirty()
    }
}

// Allow using UUID directly with .sheet(item:)
extension UUID: Identifiable {
    public var id: UUID { self }
}

// MARK: - Conversation Row
struct ConversationRow: View {
    let convo: Conversation
    let known: [KnownSpeaker]

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            BubbleClusterView(participants: convo.participants, known: known)
                .frame(width: 56, height: 56)
                .environmentObject(ContentViewModel())

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    let title = titleFor(convo.participants)
                    Text(title)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(title == "No speakers" ? .secondary : .primary)
                        .lineLimit(1)
                    Spacer()
                    Text(timeString(for: convo.date))
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                if !convo.lastSnippet.isEmpty {
                    Text(convo.lastSnippet)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                        .truncationMode(.tail)
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func titleFor(_ participants: [String]) -> String {
        let filtered = participants.filter { $0 != "Speaker ?" }
        if filtered.isEmpty { return "No speakers" }
        if filtered.count <= 2 { return filtered.joined(separator: " & ") }
        return filtered.joined(separator: ", ")
    }

    private func timeString(for date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) {
            let f = DateFormatter(); f.dateStyle = .none; f.timeStyle = .short; return f.string(from: date)
        }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .none; return f.string(from: date)
    }
}

struct BubbleClusterView: View {
    let participants: [String]
    let known: [KnownSpeaker]

    var body: some View {
        let uniques = Array(LinkedHashSet(sequence: participants.filter { $0 != "Speaker ?" })).prefix(3)
        ZStack {
            switch uniques.count {
            case 0:
                // Single placeholder fills area
                Circle()
                    .fill(Color(UIColor.systemGray5))
                    .frame(width: 56, height: 56)
                    .position(x: 28, y: 28)
            case 1:
                // One avatar fills the area
                SpeakerAvatarView(name: uniques[uniques.startIndex], known: known)
                    .frame(width: 56, height: 56)
                    .position(x: 28, y: 28)
            case 2:
                // Two avatars, slightly smaller so both fit side-by-side
                let first = uniques[uniques.startIndex]
                let second = uniques[uniques.index(after: uniques.startIndex)]
                SpeakerAvatarView(name: first, known: known)
                    .frame(width: 40, height: 40)
                    .position(x: 20, y: 28)
                    .zIndex(2)
                SpeakerAvatarView(name: second, known: known)
                    .frame(width: 40, height: 40)
                    .position(x: 36, y: 28)
                    .zIndex(1)
            default:
                // Three avatars with current layout
                ForEach(Array(uniques.enumerated()), id: \.offset) { idx, name in
                    let size: CGFloat = [42, 32, 28][min(idx, 2)]
                    let offset: (x: CGFloat, y: CGFloat) = idx == 0 ? (0,0) : (idx == 1 ? (-16, 12) : (16, 12))
                    SpeakerAvatarView(name: name, known: known)
                        .frame(width: size, height: size)
                        .position(x: 28 + offset.x, y: 28 + offset.y)
                        .zIndex(idx == 0 ? 2 : 1)
                }
            }
        }
    }
}

// Simple ordered unique utility
struct LinkedHashSet<Element: Hashable>: Sequence {
    private var set: Set<Element> = []
    private var order: [Element] = []
    init(sequence: [Element]) { sequence.forEach { insert($0) } }
    mutating func insert(_ e: Element) { if !set.contains(e) { set.insert(e); order.append(e) } }
    func makeIterator() -> IndexingIterator<[Element]> { order.makeIterator() }
}
