import Foundation
import AVFoundation
#if canImport(MicrosoftCognitiveServicesSpeech)
import MicrosoftCognitiveServicesSpeech
#endif

final class TestConversationPlayer: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    #if canImport(MicrosoftCognitiveServicesSpeech)
    private var azureSynth: SPXSpeechSynthesizer?
    #endif
    @Published private(set) var isRunning = false
    private var currentLineIndex = 0
    private var nextWorkItem: DispatchWorkItem?

    private struct ScriptLine { let speaker: String; let text: String }

    // Deterministic script stored as "speaker: text" pairs
    private let script: [ScriptLine] = [
        .init(speaker: "Alex", text: "Morning team, quick stand-up: we’re finalizing the onboarding flow today."),
        .init(speaker: "Alex", text: "I pushed the new welcome screens last night, but analytics gating needs a review."),
        .init(speaker: "Daniel", text: "Jorge, can you confirm the event names for the funnel?"),
        .init(speaker: "Alex", text: "Yep, renamed signup start to onboarding begin and added step labels."),
        // Alex follows up immediately to create contiguous bubbles
        .init(speaker: "Alex", text: "I’ll post the doc in the channel after this stand‑up."),
        .init(speaker: "Samantha", text: "We still need a guard so we don’t double report when users bounce back."),
        .init(speaker: "Daniel", text: "After lunch I’ll also run the A/B test export and update the dashboard."),
        // Samantha back‑to‑back as well
        .init(speaker: "Samantha", text: "Also, I’ll polish the spacing on the transcript bubbles."),
        .init(speaker: "Alex", text: "Perfect. I’ll wire the gating to the new IDs and check dashboards."),
        .init(speaker: "Samantha", text: "By the way, support reported that the microphone permission sheet appears twice."),
        .init(speaker: "Daniel", text: "I saw it once on simulator; could be restarting the audio engine during the alert."),
        .init(speaker: "Alex", text: "Let’s add a debounce so we never present it twice. I can tackle that."),
        .init(speaker: "Samantha", text: "Great. For the demo we’ll run a one‑minute mock conversation and record it."),
        .init(speaker: "Daniel", text: "If the transcript looks solid we’ll ship a TestFlight build tonight."),
        .init(speaker: "Alex", text: "Any blockers before we wrap?"),
        .init(speaker: "Samantha", text: "None from me."),
        .init(speaker: "Daniel", text: "I’ll validate diarization and clean up duplicate lines in the coalescer."),
        .init(speaker: "Alex", text: "Awesome. Thanks everyone—let’s get this out!"),
    ]

    // Explicit deterministic mapping per character -> Azure neural voice
    private let voiceForSpeaker: [String: String] = [
        "Alex": "en-US-GuyNeural",      // male
        "Samantha": "en-US-JennyNeural", // female
        "Daniel": "en-GB-RyanNeural"     // male
    ]
    private func voiceName(for speaker: String) -> String {
        return voiceForSpeaker[speaker] ?? "en-US-AriaNeural"
    }

    // Roughly ~60s at the configured rate and pauses by looping the script

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func start() {
        guard !isRunning else { return }
        isRunning = true
        currentLineIndex = 0
        #if canImport(MicrosoftCognitiveServicesSpeech)
        // Initialize Azure TTS to get natural voices, matching Python generator
        if azureSynth == nil {
            if let key = ProcessInfo.processInfo.environment["SPEECH_KEY"],
               let region = ProcessInfo.processInfo.environment["SPEECH_REGION"],
               let cfg = try? SPXSpeechConfiguration(subscription: key, region: region) {
                // Prefer service default neural output; explicit format setting not available in ObjC wrapper
                azureSynth = try? SPXSpeechSynthesizer(speechConfiguration: cfg, audioConfiguration: SPXAudioConfiguration())
                // Chain the script by scheduling next line after completion
                azureSynth?.addSynthesisCompletedEventHandler { [weak self] _, _ in
                    self?.scheduleNext(after: 0.25)
                }
                azureSynth?.addSynthesisCanceledEventHandler { [weak self] _, _ in
                    self?.scheduleNext(after: 0.25)
                }
            }
        }
        #endif
        scheduleNext(after: 0.1)
    }

    func stop() {
        isRunning = false
        nextWorkItem?.cancel()
        nextWorkItem = nil
        synthesizer.stopSpeaking(at: .immediate)
        #if canImport(MicrosoftCognitiveServicesSpeech)
        if let synth = azureSynth { try? synth.stopSpeaking() }
        #endif
    }

    private func scheduleNext(after delay: TimeInterval) {
        guard isRunning else { return }
        let work = DispatchWorkItem { [weak self] in self?.speakRandomUtterance() }
        nextWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func speakRandomUtterance() {
        guard isRunning else { return }
        let line = script[currentLineIndex % script.count]
        currentLineIndex += 1

        #if canImport(MicrosoftCognitiveServicesSpeech)
        if let azureSynth {
            // Use SSML with neural style for more natural delivery
            let voiceName = voiceName(for: line.speaker)
            let ssml = """
            <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='en-US'>
              <voice name='\(voiceName)'>
                <mstts:express-as style='chat' styledegree='1.0'>
                  <prosody rate='0%' pitch='0%'>\(line.text)</prosody>
                </mstts:express-as>
              </voice>
            </speak>
            """
            _ = try? azureSynth.startSpeakingSsml(ssml)
        } else {
            print("[TestConversationPlayer] Azure TTS unavailable; falling back to AVSpeechSynthesizer")
            let utterance = AVSpeechUtterance(string: line.text)
            utterance.rate = 0.48
            utterance.pitchMultiplier = 1.0
            utterance.postUtteranceDelay = 0.35
            // Fallback voice selection by language from voice name
            let v = voiceName(for: line.speaker)
            let langCode = v.contains("en-GB") ? "en-GB" : (v.contains("en-AU") ? "en-AU" : "en-US")
            utterance.voice = AVSpeechSynthesisVoice(language: langCode)
            synthesizer.speak(utterance)
        }
        #else
        let utterance = AVSpeechUtterance(string: line.text)
        utterance.rate = 0.48
        utterance.pitchMultiplier = 1.0
        utterance.postUtteranceDelay = 0.35
        let v = voiceName(for: line.speaker)
        let langCode = v.contains("en-GB") ? "en-GB" : (v.contains("en-AU") ? "en-AU" : "en-US")
        utterance.voice = AVSpeechSynthesisVoice(language: langCode)
        synthesizer.speak(utterance)
        #endif
    }

    // MARK: - AVSpeechSynthesizerDelegate
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        scheduleNext(after: 0.25)
    }
}

