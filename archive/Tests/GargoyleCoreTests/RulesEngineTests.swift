import Testing
import Foundation
@testable import GargoyleCore

// MARK: - Fixtures

private func ctx(app: String = "Slack", teamID: String? = "TEAM42",
                 host: String? = "api.slack.com", ip: String = "3.4.5.6",
                 port: UInt16 = 443, proto: UInt8 = 6,
                 isSystem: Bool = false) -> FlowContext {
    FlowContext(appKey: AppKey(signingID: "com.example.\(app)", teamID: teamID, path: nil),
                appName: app, isSystem: isSystem,
                host: host, ip: ip, port: port, proto: proto)
}

private func rule(_ destination: Destination, action: RuleAction = .block,
                  app: AppSelector = .app(AppKey(signingID: "com.example.Slack",
                                                 teamID: "TEAM42", path: nil)),
                  port: PortSelector = .any, proto: ProtoSelector = .any,
                  scope: RuleScope = .persistent, id: Int64 = 0) -> Rule {
    Rule(id: id, profileID: 1, app: app, destination: destination,
         port: port, proto: proto, action: action, scope: scope, notes: nil)
}

// MARK: - Destination matching

@Suite struct DestinationMatcherTests {
    @Test func exactHostMatchesCaseInsensitively() {
        #expect(Destination.host("api.slack.com").matches(host: "API.Slack.com", ip: "3.4.5.6"))
        #expect(!Destination.host("api.slack.com").matches(host: "cdn.slack.com", ip: "3.4.5.6"))
    }

    @Test func suffixMatchesSubdomainsAndApex() {
        let suffix = Destination.suffix("slack.com")
        #expect(suffix.matches(host: "api.slack.com", ip: "1.2.3.4"))
        #expect(suffix.matches(host: "a.b.slack.com", ip: "1.2.3.4"))
        #expect(suffix.matches(host: "slack.com", ip: "1.2.3.4"), "apex must match its own suffix rule")
        // Must not match a different registrable domain that merely ends in the text.
        #expect(!suffix.matches(host: "notslack.com", ip: "1.2.3.4"))
        #expect(!suffix.matches(host: "slack.com.evil.net", ip: "1.2.3.4"))
    }

    @Test func ipMatchesExactly() {
        #expect(Destination.ip("3.4.5.6").matches(host: nil, ip: "3.4.5.6"))
        #expect(!Destination.ip("3.4.5.6").matches(host: nil, ip: "3.4.5.7"))
    }

    @Test func cidrMatchesRangeV4() {
        let cidr = Destination.cidr("10.0.0.0/8")
        #expect(cidr.matches(host: nil, ip: "10.1.2.3"))
        #expect(cidr.matches(host: nil, ip: "10.255.255.255"))
        #expect(!cidr.matches(host: nil, ip: "11.0.0.1"))

        let tight = Destination.cidr("192.168.1.0/24")
        #expect(tight.matches(host: nil, ip: "192.168.1.77"))
        #expect(!tight.matches(host: nil, ip: "192.168.2.77"))

        // /32 is a single host; /0 is everything.
        #expect(Destination.cidr("1.2.3.4/32").matches(host: nil, ip: "1.2.3.4"))
        #expect(!Destination.cidr("1.2.3.4/32").matches(host: nil, ip: "1.2.3.5"))
        #expect(Destination.cidr("0.0.0.0/0").matches(host: nil, ip: "8.8.8.8"))
    }

    @Test func cidrMatchesRangeV6() {
        let cidr = Destination.cidr("2606:4700::/32")
        #expect(cidr.matches(host: nil, ip: "2606:4700:1:2::3"))
        #expect(!cidr.matches(host: nil, ip: "2607:4700::1"))
    }

    @Test func anyMatchesEverything() {
        #expect(Destination.any.matches(host: nil, ip: "1.2.3.4"))
        #expect(Destination.any.matches(host: "x.example", ip: "::1"))
    }

    @Test func malformedCIDRNeverMatches() {
        #expect(!Destination.cidr("garbage").matches(host: nil, ip: "1.2.3.4"))
        #expect(!Destination.cidr("10.0.0.0/99").matches(host: nil, ip: "10.0.0.1"))
    }

    /// Specificity drives "most-specific destination wins" (spec §5).
    @Test func specificityOrdering() {
        #expect(Destination.host("a.b.com").specificity > Destination.suffix("a.b.com").specificity)
        #expect(Destination.ip("1.2.3.4").specificity > Destination.cidr("1.2.3.0/24").specificity)
        #expect(Destination.suffix("a.b.com").specificity > Destination.suffix("b.com").specificity,
                "a longer suffix is more specific than a shorter one")
        #expect(Destination.cidr("10.0.0.0/24").specificity > Destination.cidr("10.0.0.0/8").specificity)
        #expect(Destination.suffix("b.com").specificity > Destination.any.specificity)
    }
}

// MARK: - Precedence

@Suite struct RulesPrecedenceTests {
    private let slack = AppKey(signingID: "com.example.Slack", teamID: "TEAM42", path: nil)

    /// Spec §5 order: session/once → app+destination (most specific) → app-wide
    /// → global destination → per-app mode default → global default.
    @Test func sessionApprovalBeatsPersistentRules() {
        var engine = RulesEngine()
        engine.replaceRules([rule(.suffix("slack.com"), action: .block, id: 1)])
        engine.setMode(slack, .firewall)
        engine.addSessionApproval(app: slack, destination: .host("api.slack.com"),
                                  action: .allow, scope: .untilQuit)

        let decision = engine.evaluate(ctx())
        #expect(decision.action == .allow)
        #expect(decision.source == .sessionApproval)
        #expect(decision.trace.first?.contains("session") == true)
    }

    @Test func onceApprovalIsConsumedAfterFirstUse() {
        var engine = RulesEngine()
        engine.setMode(slack, .firewall)
        engine.addSessionApproval(app: slack, destination: .host("api.slack.com"),
                                  action: .allow, scope: .once)

        #expect(engine.evaluate(ctx()).action == .allow)
        // Second flow to the same destination must fall through to the mode default.
        let second = engine.evaluate(ctx())
        #expect(second.action == .prompt, "a once-approval must not survive its use")
        #expect(second.source == .appModeDefault)
    }

    @Test func mostSpecificDestinationWinsAmongAppRules() {
        var engine = RulesEngine()
        engine.replaceRules([
            rule(.suffix("slack.com"), action: .allow, id: 1),
            rule(.host("telemetry.slack.com"), action: .block, id: 2),
        ])
        let allowed = engine.evaluate(ctx(host: "api.slack.com"))
        #expect(allowed.action == .allow)
        #expect(allowed.matchedRuleID == 1)

        let blocked = engine.evaluate(ctx(host: "telemetry.slack.com"))
        #expect(blocked.action == .block)
        #expect(blocked.matchedRuleID == 2, "the exact host must beat the broader suffix")
        #expect(blocked.source == .appDestinationRule)
    }

    @Test func appWideRuleBeatsGlobalDestinationRule() {
        var engine = RulesEngine()
        engine.replaceRules([
            rule(.any, action: .allow, app: .app(slack), id: 1),          // app-wide
            rule(.suffix("slack.com"), action: .block, app: .anyApp, id: 2),  // global dest
        ])
        let decision = engine.evaluate(ctx())
        #expect(decision.action == .allow)
        #expect(decision.matchedRuleID == 1)
        #expect(decision.source == .appWideRule)
    }

    @Test func globalDestinationRuleAppliesAcrossApps() {
        var engine = RulesEngine()
        engine.replaceRules([rule(.suffix("doubleclick.net"), action: .block, app: .anyApp, id: 5)])
        let decision = engine.evaluate(ctx(app: "Safari", host: "ads.doubleclick.net"))
        #expect(decision.action == .block)
        #expect(decision.matchedRuleID == 5)
        #expect(decision.source == .globalDestinationRule)
    }

    /// Per-app mode default (spec §4): Monitor allows+alerts, Firewall prompts,
    /// Ignore drops the flow from the pipeline entirely.
    @Test func perAppModeDefaults() {
        var engine = RulesEngine()
        engine.setMode(slack, .monitor)
        #expect(engine.evaluate(ctx()).action == .alert)

        engine.setMode(slack, .firewall)
        #expect(engine.evaluate(ctx()).action == .prompt)

        engine.setMode(slack, .ignore)
        #expect(engine.evaluate(ctx()).action == .ignore)
    }

    /// Global default is Monitor (spec §13.2).
    @Test func globalDefaultIsMonitor() {
        var engine = RulesEngine()
        let decision = engine.evaluate(ctx(app: "Unknown"))
        #expect(decision.action == .alert)
        #expect(decision.source == .globalDefault)
    }

    /// System daemons are excluded by default and never firewalled (spec §4, §13.3).
    @Test func systemAppsAreIgnoredUnlessOptedIn() {
        var engine = RulesEngine()
        #expect(engine.evaluate(ctx(app: "trustd", isSystem: true)).action == .ignore)

        engine.includeSystemApps = true
        let included = engine.evaluate(ctx(app: "trustd", isSystem: true))
        #expect(included.action == .alert, "opted-in system apps monitor, never firewall")

        // Even if a system app is set to Firewall, it must not prompt.
        let trustd = AppKey(signingID: "com.example.trustd", teamID: "TEAM42", path: nil)
        engine.setMode(trustd, .firewall)
        #expect(engine.evaluate(ctx(app: "trustd", isSystem: true)).action == .alert)
    }

    @Test func portAndProtocolNarrowMatches() {
        var engine = RulesEngine()
        engine.replaceRules([
            rule(.any, action: .block, port: .port(53), proto: .proto(17), id: 1),
        ])
        #expect(engine.evaluate(ctx(port: 53, proto: 17)).matchedRuleID == 1)
        #expect(engine.evaluate(ctx(port: 443, proto: 6)).matchedRuleID == nil,
                "a port/proto-scoped rule must not match other traffic")
    }

    @Test func expiredUntilRuleIsSkipped() {
        let past = Date(timeIntervalSince1970: 1_600_000_000)
        var engine = RulesEngine()
        engine.replaceRules([
            rule(.any, action: .allow, scope: .until(past), id: 1),
        ])
        engine.setMode(slack, .firewall)
        let decision = engine.evaluate(ctx(), now: Date())
        #expect(decision.matchedRuleID == nil, "an expired rule must not match")
        #expect(decision.action == .prompt)
    }

    @Test func ruleForAnotherAppDoesNotMatch() {
        var engine = RulesEngine()
        engine.replaceRules([rule(.any, action: .block, id: 1)])   // Slack-only rule
        let decision = engine.evaluate(ctx(app: "Zoom"))
        #expect(decision.matchedRuleID == nil)
        #expect(decision.source == .globalDefault)
    }

    /// Signer change suspends rules and forces a re-prompt (spec §4).
    @Test func teamIDMismatchSuspendsAppRules() {
        var engine = RulesEngine()
        engine.replaceRules([rule(.any, action: .allow, id: 1)])
        let impostor = ctx(teamID: "OTHER99")
        let decision = engine.evaluate(impostor)
        #expect(decision.matchedRuleID == nil, "rules must not carry over to a different signer")
    }

    /// Every decision explains itself (spec §5 "why was this allowed/blocked?").
    @Test func traceRecordsEveryConsideredStage() {
        var engine = RulesEngine()
        engine.replaceRules([
            rule(.suffix("slack.com"), action: .block, id: 7, ),
        ])
        engine.setMode(slack, .firewall)
        let decision = engine.evaluate(ctx())

        #expect(decision.trace.count >= 2, "trace must show the stages considered, not just the winner")
        #expect(decision.trace.last?.contains("rule 7") == true)
        #expect(decision.explanation.contains("block"))
    }

    @Test func hitCountsTrackMatches() {
        var engine = RulesEngine()
        engine.replaceRules([rule(.any, action: .allow, id: 3)])
        _ = engine.evaluate(ctx())
        _ = engine.evaluate(ctx())
        #expect(engine.hitCounts[3] == 2)
    }
}
