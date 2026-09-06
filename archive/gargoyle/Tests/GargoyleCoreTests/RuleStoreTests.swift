import Testing
import Foundation
@testable import GargoyleCore

private let slack = AppKey(signingID: "com.example.Slack", teamID: "TEAM42", path: nil)

private func makeStore() throws -> (AuditStore, RuleStore) {
    let audit = try AuditStore.inMemory()
    return (audit, try RuleStore(store: audit))
}

@Suite struct RuleStoreTests {
    @Test func createsDefaultActiveProfile() throws {
        let (_, rules) = try makeStore()
        let active = try rules.activeProfile()
        #expect(active.name == "Normal")
        #expect(active.isActive)
    }

    @Test func rulesRoundTripWithAssignedIDs() throws {
        let (_, store) = try makeStore()
        let profileID = try store.activeProfile().id

        let id = try store.addRule(Rule(id: 0, profileID: profileID, app: .app(slack),
                                        destination: .suffix("slack.com"), action: .allow,
                                        notes: "work chat"))
        let loaded = try store.activeRules()
        #expect(loaded.count == 1)
        #expect(loaded[0].id == id, "the row id must override the placeholder id")
        #expect(loaded[0].destination == .suffix("slack.com"))
        #expect(loaded[0].action == .allow)
        #expect(loaded[0].notes == "work chat")

        try store.deleteRule(id: id)
        #expect(try store.activeRules().isEmpty)
    }

    /// Exactly one profile is active; switching swaps the visible rule set.
    @Test func switchingProfilesSwapsRules() throws {
        let (_, store) = try makeStore()
        let normal = try store.activeProfile().id
        try store.addRule(Rule(id: 0, profileID: normal, app: .anyApp,
                               destination: .suffix("telemetry.example"), action: .alert))

        let paranoid = try store.createProfile(name: "Paranoid")
        try store.addRule(Rule(id: 0, profileID: paranoid, app: .anyApp,
                               destination: .any, action: .block))

        #expect(try store.activeRules().count == 1)
        #expect(try store.activeRules().first?.action == .alert)

        try store.activateProfile(id: paranoid)
        #expect(try store.activeProfile().name == "Paranoid")
        #expect(try store.activeRules().first?.action == .block)
        #expect(try store.profiles().filter(\.isActive).count == 1)
    }

    @Test func modesPersistPerApp() throws {
        let (_, store) = try makeStore()
        try store.setMode(.firewall, for: slack)
        #expect(try store.modes()[slack] == .firewall)

        try store.setMode(.ignore, for: slack)   // upsert, not duplicate
        #expect(try store.modes()[slack] == .ignore)
        #expect(try store.modes().count == 1)
    }

    @Test func hitCountsAccumulate() throws {
        let (_, store) = try makeStore()
        let profileID = try store.activeProfile().id
        let id = try store.addRule(Rule(id: 0, profileID: profileID, app: .anyApp,
                                        destination: .any, action: .allow))
        try store.recordHits([id: 3])
        try store.recordHits([id: 2])
        #expect(try store.hitCount(id: id) == 5)
    }

    @Test func verdictEventsPersistTrace() throws {
        let (_, store) = try makeStore()
        let decision = Decision(action: .block, source: .appDestinationRule,
                                matchedRuleID: 9, trace: ["no session approval", "matched rule 9"])
        try store.recordVerdict(flowSeq: 42, decision: decision, wouldHaveBlocked: true)

        let events = try store.verdictEvents()
        #expect(events.count == 1)
        #expect(events[0].action == "block")
        #expect(events[0].wouldHaveBlocked)
        #expect(events[0].matchedRuleID == 9)
        #expect(events[0].trace == ["no session approval", "matched rule 9"])
    }

    /// Profiles are exportable/importable as JSON (spec §5).
    @Test func exportImportRoundTrip() throws {
        let (_, store) = try makeStore()
        let profileID = try store.activeProfile().id
        try store.addRule(Rule(id: 0, profileID: profileID, app: .app(slack),
                               destination: .host("telemetry.slack.com"), action: .block))
        try store.addRule(Rule(id: 0, profileID: profileID, app: .anyApp,
                               destination: .cidr("10.0.0.0/8"), action: .allow))

        let json = try store.exportProfile(id: profileID)
        let importedID = try store.importProfile(json)

        let imported = try store.rules(profileID: importedID)
        #expect(imported.count == 2)
        #expect(imported.contains { $0.destination == .host("telemetry.slack.com") && $0.action == .block })
        #expect(imported.contains { $0.destination == .cidr("10.0.0.0/8") })
        #expect(imported.allSatisfy { $0.profileID == importedID }, "imported rules must belong to the new profile")

        // Name collision resolves rather than throwing.
        let names = try store.profiles().map(\.name)
        #expect(names.contains("Normal"))
        #expect(names.contains("Normal 2"))
    }
}
