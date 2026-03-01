import Foundation
import Combine
import OSLog

final class ContentViewModel: ObservableObject, TranscriptManagerDelegate {
    // MARK: - Logging
    private let logger = Logger(subsystem: "com.example.MeetingTranscriber", category: "ContentViewModel")
    static var debugLoggingEnabled: Bool = true
    private func logInfo(_ message: String) {
        guard Self.debugLoggingEnabled else { return }
        logger.notice("[VM] \(message, privacy: .public)")
    }
    private func logDebug(_ message: String) {
        guard Self.debugLoggingEnabled else { return }
        logger.debug("[VM] \(message, privacy: .public)")
    }
    private func snippet(_ text: String, limit: Int = 120) -> String {
        if text.count <= limit { return text }
        let idx = text.index(text.startIndex, offsetBy: limit)
        return String(text[..<idx]) + "…"
    }
    @Published var recordingState: RecordingState = .idle
    @Published var transcriptItems: [TranscriptLine] = []
    @Published var errorMessage: String?
    @Published var isDirty: Bool = false
    @Published var knownSpeakers: [KnownSpeaker] = [] {
        didSet { persistSpeakers() }
    }
    private var colorMap: [String: String] = [:]
    private let palette: [String] = SpeakerColors.palette
    private var speakerOrder: [String] = []

    func onAppear() {
        TranscriptManager.shared.delegate = self
        loadSpeakers()
        logInfo("onAppear: delegate set, knownSpeakers=\(knownSpeakers.count)")
    }

    func startStop() {
        switch recordingState {
        case .idle:
            logInfo("action: start requested (idle -> recording)")
            Task { await start() }
        case .recording, .paused:
            logInfo("action: stop requested (\(String(describing: recordingState)))")
            TranscriptManager.shared.stop()
            recordingState = .idle
            logInfo("state: recordingState=idle")
        }
    }

    private func start() async {
        do {
            try await TranscriptManager.shared.start()
            await MainActor.run { self.recordingState = .recording }
            logInfo("start: audio+azure started, recordingState=recording")
        } catch {
            await MainActor.run {
                self.errorMessage = error.localizedDescription
                self.recordingState = .idle
            }
            logInfo("start: FAILED error='\(error.localizedDescription)' -> recordingState=idle")
        }
    }

    // MARK: - TranscriptManagerDelegate
    func didReceiveSegment(_ segment: AttributedString) {
        // Expect format "Speaker: text" from manager helper
        let parts = segment.characters.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let speaker = String(parts.first.map(String.init) ?? "Unknown")
        let text = String(parts.dropFirst().joined()).trimmingCharacters(in: .whitespaces)
        logInfo("segment:new speaker='\(speaker)' len=\(text.count) idx=\(transcriptItems.count) snippet='\(snippet(text))'")

        transcriptItems.append(TranscriptLine(speaker: speaker, text: text, timestamp: Date()))
        assignColorIfNeeded(for: speaker)
        noteSpeaker(speaker)
        isDirty = true
        logDebug("segment:appended total=\(transcriptItems.count)")
    }

    func didUpdateLastSegment(_ segment: AttributedString) {
        guard !transcriptItems.isEmpty else {
            let parts = segment.characters.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            let speaker = String(parts.first.map(String.init) ?? "Unknown")
            let text = String(parts.dropFirst().joined()).trimmingCharacters(in: .whitespaces)
            logInfo("segment:update-empty -> creating new speaker='\(speaker)' len=\(text.count) snippet='\(snippet(text))'")
            transcriptItems = [TranscriptLine(speaker: speaker, text: text, timestamp: Date())]
            return
        }
        let parts = segment.characters.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let speaker = String(parts.first.map(String.init) ?? "Unknown")
        let text = String(parts.dropFirst().joined()).trimmingCharacters(in: .whitespaces)
        let prev = transcriptItems[transcriptItems.count - 1]
        logInfo("segment:update-last idx=\(transcriptItems.count - 1) prevSpeaker='\(prev.speaker)'->'\(speaker)' prevLen=\(prev.text.count) newLen=\(text.count) newSnippet='\(snippet(text))'")
        transcriptItems[transcriptItems.count - 1].speaker = speaker
        transcriptItems[transcriptItems.count - 1].text = text
        assignColorIfNeeded(for: speaker)
        noteSpeaker(speaker)
        isDirty = true
        logDebug("segment:updated total=\(transcriptItems.count)")
    }

    func didReceiveError(_ message: String) {
        errorMessage = message
        logInfo("error: \(message)")
    }
}
// MARK: - Import/Export
extension ContentViewModel {
    struct JSONMessage: Codable { let t: String; let speaker: String; let text: String }
    struct JSONConversation: Codable { let id: String; let date: String; let participants: [String]; let messages: [JSONMessage] }

    func exportJSON(conversationId: UUID) -> Data? {
        let iso = ISO8601DateFormatter()
        let participants = Array(Set(transcriptItems.map { $0.speaker }).subtracting(["Speaker ?"]))
        let msgs = transcriptItems.map { JSONMessage(t: iso.string(from: $0.timestamp), speaker: $0.speaker, text: $0.text) }
        let convo = JSONConversation(id: conversationId.uuidString, date: iso.string(from: Date()), participants: participants, messages: msgs)
        return try? JSONEncoder().encode(convo)
    }

    func importJSON(_ data: Data) {
        print("Attempting to decode JSON data...")
        if let decoded = try? JSONDecoder().decode(JSONConversation.self, from: data) {
            print("Decoded conversation with \(decoded.messages.count) messages")
            let iso = ISO8601DateFormatter()
            transcriptItems = decoded.messages.compactMap { msg in
                TranscriptLine(speaker: msg.speaker, text: msg.text, timestamp: iso.date(from: msg.t) ?? Date())
            }
            print("Created \(transcriptItems.count) transcript items")
            rebuildColors()
            isDirty = false
        } else {
            print("Failed to decode JSON data")
            if let jsonString = String(data: data, encoding: .utf8) {
                print("Raw JSON: \(jsonString.prefix(200))...")
            }
        }
    }

    func participantsList() -> [String] { Array(Set(transcriptItems.map { $0.speaker }).subtracting(["Speaker ?"])) }
    func lastSnippet() -> String { transcriptItems.last?.text ?? "" }
    func clearDirty() { isDirty = false }
    // Colors
    private func assignColorIfNeeded(for speaker: String) {
        guard speaker != "Speaker ?" else { return }
        if colorMap[speaker] != nil { return }
        let used = Set(colorMap.values)
        // Deterministic mapping across app
        colorMap[speaker] = SpeakerColors.colorHex(for: speaker)
    }
    private func rebuildColors() {
        colorMap.removeAll(); for s in participantsList() { assignColorIfNeeded(for: s) }
    }
    func colorHex(for speaker: String) -> String? { colorMap[speaker] }
    private func noteSpeaker(_ s: String) { if s != "Speaker ?" && !speakerOrder.contains(s) { speakerOrder.append(s) } }
    func speakerOrderList() -> [String] { speakerOrder }
}

// MARK: - Persistence
private extension ContentViewModel {
    func persistSpeakers() {
        if let data = try? JSONEncoder().encode(knownSpeakers) {
            UserDefaults.standard.set(data, forKey: "knownSpeakers")
        }
    }
    func loadSpeakers() {
        if let data = UserDefaults.standard.data(forKey: "knownSpeakers"), let arr = try? JSONDecoder().decode([KnownSpeaker].self, from: data) {
            knownSpeakers = arr
        }
    }
}

