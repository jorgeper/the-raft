import Testing
import Foundation
@testable import GargoyleCore

private func decision(_ action: FlowAction) -> Decision {
    Decision(action: action, source: .appModeDefault, matchedRuleID: nil, trace: [])
}

@Suite struct FilterVerdictPolicyTests {
    @Test func rulesAreAppliedDirectly() {
        #expect(FilterVerdictPolicy.decide(decision(.allow), appReachable: true).verdict == .allow)
        #expect(FilterVerdictPolicy.decide(decision(.block), appReachable: true).verdict == .drop)
        #expect(FilterVerdictPolicy.decide(decision(.alert), appReachable: true).verdict == .allow)
    }

    @Test func promptHoldsWhenTheAppCanAnswer() {
        let outcome = FilterVerdictPolicy.decide(decision(.prompt), appReachable: true)
        #expect(outcome.verdict == .hold)
        #expect(!outcome.missedPrompt)
    }

    /// Spec §13.1: fail closed — an unanswerable prompt drops the flow and
    /// records a missed prompt.
    @Test func promptFailsClosedWhenTheAppIsUnreachable() {
        let outcome = FilterVerdictPolicy.decide(decision(.prompt), appReachable: false)
        #expect(outcome.verdict == .drop)
        #expect(outcome.missedPrompt, "a drop nobody was asked about must be recorded")
    }

    /// A rule-based block does not depend on the app being reachable, and it is
    /// not a missed prompt — the human already decided.
    @Test func blockDoesNotNeedTheApp() {
        let outcome = FilterVerdictPolicy.decide(decision(.block), appReachable: false)
        #expect(outcome.verdict == .drop)
        #expect(!outcome.missedPrompt)
    }

    /// Monitoring must never break the network: an ignored or monitored flow is
    /// allowed even with the UI app dead.
    @Test func monitoringNeverDropsWhenAppIsDown() {
        #expect(FilterVerdictPolicy.decide(decision(.alert), appReachable: false).verdict == .allow)
        #expect(FilterVerdictPolicy.decide(decision(.ignore), appReachable: false).verdict == .allow)
    }
}
