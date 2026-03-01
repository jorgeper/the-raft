import Foundation
import AVFoundation
import OSLog

protocol TranscriptManagerDelegate: AnyObject {
    func didReceiveSegment(_ segment: AttributedString)
    func didUpdateLastSegment(_ segment: AttributedString)
    func didReceiveError(_ message: String)
}

extension TranscriptManagerDelegate {
    func didUpdateLastSegment(_ segment: AttributedString) {}
}

final class TranscriptManager: NSObject {
    static let shared = TranscriptManager()
    private let logger = Logger(subsystem: "com.example.MeetingTranscriber", category: "TranscriptManager")
    
    weak var delegate: TranscriptManagerDelegate?
    
    private let audioEngine = AVAudioEngine()
    private var inputNode: AVAudioInputNode? { audioEngine.inputNode }
    private var tapInstalled: Bool = false
    
    private let session = AVAudioSession.sharedInstance()
    private let azure = AzureTranscriber()
    
    private override init() { 
        super.init()
        azure.delegate = self 
    }
    
    // MARK: - State Management
    
    private struct Segment {
        let id = UUID()
        var text: String
        var speakerId: String
        var displayName: String
        var createdAt: Date
        var updatedAt: Date
        var isFinal: Bool = false
    }
    
    // Keep track of the current working segment
    private var currentSegment: Segment?
    
    // Keep track of ALL segments to prevent duplicates
    private var allSegments: [Segment] = []
    private let maxSegmentHistory = 10
    
    private let pauseThreshold: TimeInterval = 1.5
    
    // MARK: - Public API
    
    func start() async throws {
        try await requestMicPermission()
        try configureAudioSession()
        try startEngine()
        try azure.start()
    }
    
    func pause() {
        audioEngine.pause()
    }
    
    func stop() {
        if tapInstalled, let inputNode {
            inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        audioEngine.stop()
        audioEngine.reset()
        azure.stop()
        
        // Reset state
        currentSegment = nil
        allSegments.removeAll()
    }
    
    // MARK: - Private Methods
    
    private func requestMicPermission() async throws {
        try await withCheckedThrowingContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                if granted {
                    continuation.resume()
                } else {
                    continuation.resume(throwing: NSError(
                        domain: "TranscriptManager",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Microphone permission denied"]
                    ))
                }
            }
        }
    }
    
    private func configureAudioSession() throws {
        try session.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.mixWithOthers, .duckOthers, .allowBluetooth, .defaultToSpeaker]
        )
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }
    
    private func startEngine() throws {
        guard let inputNode = inputNode else {
            throw NSError(
                domain: "TranscriptManager",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "No input node"]
            )
        }
        
        let inputFormat = inputNode.inputFormat(forBus: 0)
        let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: true
        )!
        let converter = AVAudioConverter(from: inputFormat, to: targetFormat)!
        
        if tapInstalled {
            inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        
        inputNode.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
            guard let self else { return }
            
            let pcmBuffer = AVAudioPCMBuffer(
                pcmFormat: targetFormat,
                frameCapacity: AVAudioFrameCount(targetFormat.sampleRate/10)
            )!
            
            var error: NSError?
            converter.convert(to: pcmBuffer, error: &error) { inPackets, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }
            
            if let error = error {
                self.delegate?.didReceiveError("Audio conversion error: \(error.localizedDescription)")
            }
        }
        
        try audioEngine.start()
        tapInstalled = true
    }
}

// MARK: - Azure Transcriber Delegate

extension TranscriptManager: AzureTranscriberDelegate {
    func didTranscribe(text: String, speakerId: String?, isFinal: Bool) {
        guard !text.isEmpty else { return }
        
        let now = Date()
        
        // Normalize speaker information
        let rawSpeakerId = speakerId?.isEmpty == false ? speakerId! : "Unknown"
        let displayName = formatSpeakerName(rawSpeakerId)
        
        logger.info("📝 Azure: speaker='\(rawSpeakerId)' final=\(isFinal) text='\(text.prefix(40))...'")
        
        // CRITICAL: Check if this text overlaps with ANY recent segment
        let overlapsWithExisting = allSegments.suffix(5).contains { segment in
            let timeDiff = now.timeIntervalSince(segment.updatedAt)
            return timeDiff < 3.0 && textOverlaps(text, segment.text)
        }
        
        if overlapsWithExisting && currentSegment == nil {
            logger.warning("⚠️ Ignoring - text overlaps with recent segment but no current segment")
            return
        }
        
        // Handle current segment updates
        if let current = currentSegment {
            let isSameSpeaker = (rawSpeakerId == current.speakerId)
            let isUpgrade = (current.speakerId == "Unknown" && rawSpeakerId != "Unknown" && 
                           textOverlaps(text, current.text))
            
            if isSameSpeaker || isUpgrade {
                // Update existing segment
                logger.info("🔄 Updating segment - speaker: \(isUpgrade ? "upgrading" : "same")")
                
                if isUpgrade {
                    currentSegment?.speakerId = rawSpeakerId
                    currentSegment?.displayName = displayName
                }
                
                // Update text
                if isFinal || text.count > current.text.count {
                    currentSegment?.text = text
                }
                
                currentSegment?.updatedAt = now
                currentSegment?.isFinal = isFinal
                
                // Send update
                let segment = createAttributedSegment(
                    speaker: currentSegment!.displayName,
                    text: currentSegment!.text
                )
                DispatchQueue.main.async { [weak self] in
                    self?.delegate?.didUpdateLastSegment(segment)
                }
                
                // Clear current segment if final
                if isFinal {
                    if let finalSegment = currentSegment {
                        allSegments.append(finalSegment)
                        if allSegments.count > maxSegmentHistory {
                            allSegments.removeFirst()
                        }
                    }
                    currentSegment = nil
                }
                
                return
            }
            
            // Different speaker - check for text overlap
            if textOverlaps(text, current.text) {
                logger.warning("⚠️ Ignoring - different speaker but text overlaps")
                return
            }
            
            // Finalize current segment if needed
            if current.isFinal || now.timeIntervalSince(current.updatedAt) > pauseThreshold {
                if let finalSegment = currentSegment {
                    allSegments.append(finalSegment)
                    if allSegments.count > maxSegmentHistory {
                        allSegments.removeFirst()
                    }
                }
                currentSegment = nil
            }
        }
        
        // Create new segment only if no overlap with recent segments
        if currentSegment == nil {
            logger.info("✨ Creating new segment - speaker: '\(displayName)'")
            
            var newSegment = Segment(
                text: text,
                speakerId: rawSpeakerId,
                displayName: displayName,
                createdAt: now,
                updatedAt: now,
                isFinal: isFinal
            )
            
            currentSegment = newSegment
            
            let segment = createAttributedSegment(speaker: displayName, text: text)
            DispatchQueue.main.async { [weak self] in
                self?.delegate?.didReceiveSegment(segment)
            }
            
            // If it's already final, add to history
            if isFinal {
                allSegments.append(newSegment)
                if allSegments.count > maxSegmentHistory {
                    allSegments.removeFirst()
                }
                currentSegment = nil
            }
        }
    }
    
    func didError(_ message: String) {
        DispatchQueue.main.async { [weak self] in
            self?.delegate?.didReceiveError(message)
        }
    }
}

// MARK: - Helper Methods

private extension TranscriptManager {
    func formatSpeakerName(_ speakerId: String) -> String {
        if speakerId.lowercased().hasPrefix("guest-") {
            let num = speakerId.split(separator: "-").last.map(String.init) ?? "?"
            return "Speaker \(num)"
        }
        if speakerId == "Unknown" {
            return "Speaker ?"
        }
        return speakerId
    }
    
    func createAttributedSegment(speaker: String, text: String) -> AttributedString {
        var speakerAttr = AttributedString("\(speaker): ")
        speakerAttr.foregroundColor = .secondary
        
        var textAttr = AttributedString(text)
        
        var combined = speakerAttr
        combined.append(textAttr)
        
        return combined
    }
    
    func textOverlaps(_ text1: String, _ text2: String) -> Bool {
        let t1 = text1.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let t2 = text2.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        
        if t1.isEmpty || t2.isEmpty {
            return false
        }
        
        // One contains the other (subset/superset)
        if t1.contains(t2) || t2.contains(t1) {
            return true
        }
        
        // Check word-based overlap (more reliable than character-based)
        let words1 = t1.split(separator: " ").map(String.init)
        let words2 = t2.split(separator: " ").map(String.init)
        
        // If either has less than 3 words, check if they share first word
        if words1.count < 3 || words2.count < 3 {
            return !words1.isEmpty && !words2.isEmpty && words1[0] == words2[0]
        }
        
        // Check if first 3 words match
        let firstThree1 = words1.prefix(3).joined(separator: " ")
        let firstThree2 = words2.prefix(3).joined(separator: " ")
        
        return firstThree1 == firstThree2
    }
}