import Foundation

#if canImport(MicrosoftCognitiveServicesSpeech)
import MicrosoftCognitiveServicesSpeech
#endif

protocol AzureTranscriberDelegate: AnyObject {
    func didTranscribe(text: String, speakerId: String?, isFinal: Bool)
    func didError(_ message: String)
}

final class AzureTranscriber {
    weak var delegate: AzureTranscriberDelegate?

    #if canImport(MicrosoftCognitiveServicesSpeech)
    private var transcriber: SPXConversationTranscriber?
    #endif

    func start(language: String = "en-US") throws {
        #if canImport(MicrosoftCognitiveServicesSpeech)
        guard let key = ProcessInfo.processInfo.environment["SPEECH_KEY"], !key.isEmpty else {
            throw NSError(domain: "AzureTranscriber", code: 10, userInfo: [NSLocalizedDescriptionKey: "Missing SPEECH_KEY env var in scheme settings"])
        }
        let region = ProcessInfo.processInfo.environment["SPEECH_REGION"]
        let endpoint = ProcessInfo.processInfo.environment["ENDPOINT"]

        let config: SPXSpeechConfiguration
        if let endpoint, !endpoint.isEmpty {
            config = try SPXSpeechConfiguration(endpoint: endpoint, subscription: key)
        } else if let region, !region.isEmpty {
            config = try SPXSpeechConfiguration(subscription: key, region: region)
        } else {
            throw NSError(domain: "AzureTranscriber", code: 11, userInfo: [NSLocalizedDescriptionKey: "Provide SPEECH_REGION or ENDPOINT env var"])
        }

        config.speechRecognitionLanguage = language
        config.setPropertyTo("true", by: SPXPropertyId.speechServiceResponseDiarizeIntermediateResults)

        let audioConfig = try SPXAudioConfiguration()
        let convTranscriber = try SPXConversationTranscriber(speechConfiguration: config, audioConfiguration: audioConfig)

        convTranscriber.addTranscribingEventHandler { [weak self] _, event in
            guard let self else { return }
            let text = event.result?.text ?? ""
            let speaker = event.result?.speakerId
            self.delegate?.didTranscribe(text: text, speakerId: speaker, isFinal: false)
        }

        convTranscriber.addTranscribedEventHandler { [weak self] _, event in
            guard let self else { return }
            let text = event.result?.text ?? ""
            let speaker = event.result?.speakerId
            self.delegate?.didTranscribe(text: text, speakerId: speaker, isFinal: true)
        }

        convTranscriber.addCanceledEventHandler { [weak self] _, event in
            self?.delegate?.didError("Azure canceled: \(event.errorDetails ?? String(describing: event.reason))")
        }

        convTranscriber.addSessionStoppedEventHandler { [weak self] _, _ in
            self?.delegate?.didError("Session stopped")
        }

        _ = try convTranscriber.startTranscribingAsync({ _, _ in })
        self.transcriber = convTranscriber
        #else
        throw NSError(domain: "AzureTranscriber", code: 12, userInfo: [NSLocalizedDescriptionKey: "MicrosoftCognitiveServicesSpeech not available. Run `pod install`."])
        #endif
    }

    func stop() {
        #if canImport(MicrosoftCognitiveServicesSpeech)
        try? transcriber?.stopTranscribingAsync({ _, _ in })
        transcriber = nil
        #endif
    }
}

