import Foundation

/// The decision the content-filter extension applies to a held flow.
public enum FilterVerdict: String, Sendable, Equatable {
    case allow
    case drop
    /// Hold the flow while the UI app is asked for a verdict.
    case hold
}

/// Pure policy shared by the extension and its tests — no NetworkExtension
/// types, so it is testable without the signed bundle.
///
/// Spec §2.1 (resolved decision §13.1): **fail-closed**. If the UI app is
/// unreachable and a Firewall-mode app's flow has no matching rule, the flow
/// is dropped and a "missed prompt" record is persisted. A Monitor-mode app is
/// never dropped for want of a prompt — monitoring must not break the network.
public enum FilterVerdictPolicy {
    public struct Outcome: Sendable, Equatable {
        public let verdict: FilterVerdict
        /// True when the drop happened because nobody could be asked — the
        /// event that must be persisted as a missed prompt.
        public let missedPrompt: Bool
    }

    public static func decide(_ decision: Decision, appReachable: Bool) -> Outcome {
        switch decision.action {
        case .allow, .alert:
            return Outcome(verdict: .allow, missedPrompt: false)
        case .block:
            return Outcome(verdict: .drop, missedPrompt: false)
        case .ignore:
            // Not monitored: never interfere with the traffic.
            return Outcome(verdict: .allow, missedPrompt: false)
        case .prompt:
            // Firewall mode, no rule. Ask if we can; fail closed if we cannot.
            return appReachable
                ? Outcome(verdict: .hold, missedPrompt: false)
                : Outcome(verdict: .drop, missedPrompt: true)
        }
    }
}
