import Testing
import Foundation
@testable import GargoyleCore

@Suite struct HeuristicsTests {
    private let db = HeuristicsDB()

    @Test func classifiesKnownDomainsAndSubdomains() {
        #expect(db.classify(host: "api.github.com", ip: nil).category == .devTooling)
        #expect(db.classify(host: "github.com", ip: nil).service == "GitHub")
        #expect(db.classify(host: "ads.doubleclick.net", ip: nil).category == .ads)
        #expect(db.classify(host: "sentry.io", ip: nil).category == .telemetry)
        #expect(db.classify(host: "d123.cloudfront.net", ip: nil).category == .cdn)
    }

    /// Longest matching suffix wins: gs.apple.com is Updates even though a
    /// broader apple entry exists for telemetry.
    @Test func longestSuffixWins() {
        let custom = HeuristicsDB(entries: [
            .init(suffix: "example.com", service: "Example", category: .cloud),
            .init(suffix: "telemetry.example.com", service: "Example Telemetry", category: .telemetry),
        ], networks: [])
        #expect(custom.classify(host: "telemetry.example.com", ip: nil).category == .telemetry)
        #expect(custom.classify(host: "api.example.com", ip: nil).category == .cloud)
        #expect(custom.classify(host: "deep.telemetry.example.com", ip: nil).category == .telemetry)
    }

    @Test func unknownDomainsSurfaceAsUnknown() {
        let result = db.classify(host: "weird-host.xyz", ip: "203.0.113.9")
        #expect(result == .unknown)
        #expect(result.category.ring == 4, "unknown belongs on the outermost ring")
    }

    /// A near-miss must not match: notgithub.com is not GitHub.
    @Test func suffixMatchingIsBoundaryAware() {
        #expect(db.classify(host: "notgithub.com", ip: nil) == .unknown)
        #expect(db.classify(host: "github.com.evil.net", ip: nil) == .unknown)
    }

    @Test func fallsBackToCIDRWhenNoHostname() {
        let result = db.classify(host: nil, ip: "17.253.5.204")
        #expect(result.service == "Apple")
        #expect(result.category == .cloud)
        #expect(db.classify(host: nil, ip: "140.82.113.4").service == "GitHub")
    }

    /// The hostname is more informative than the address it resolved to.
    @Test func hostnameBeatsCIDR() {
        // 104.16.x is Cloudflare's block, but the name says it's the Anthropic API.
        let result = db.classify(host: "api.anthropic.com", ip: "104.16.11.34")
        #expect(result.service == "Anthropic")
        #expect(result.category == .devTooling)
    }

    @Test func cacheReturnsStableResults() {
        let first = db.classify(host: "api.slack.com", ip: "3.4.5.6")
        let second = db.classify(host: "api.slack.com", ip: "3.4.5.6")
        #expect(first == second)
        #expect(first.category == .messaging)
    }

    @Test func categoriesMapToDistinctRings() {
        #expect(DestinationCategory.cdn.ring < DestinationCategory.telemetry.ring)
        #expect(DestinationCategory.telemetry.ring < DestinationCategory.unknown.ring)
        #expect(DestinationCategory.allCases.allSatisfy { !$0.label.isEmpty })
    }

    /// Snapshots are loaded from disk, never fetched (spec §13.4 / §10).
    @Test func loadsSnapshotFromDisk() throws {
        let json = """
        {"domains":[{"suffix":"custom.test","service":"Custom","category":"ads"}],
         "networks":[{"cidr":"10.0.0.0/8","service":"LAN","category":"cloud"}]}
        """
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("heuristics-\(UUID().uuidString).json")
        try Data(json.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let loaded = try HeuristicsDB.load(from: url)
        #expect(loaded.classify(host: "x.custom.test", ip: nil).category == .ads)
        #expect(loaded.classify(host: nil, ip: "10.1.2.3").service == "LAN")
        #expect(loaded.classify(host: "api.github.com", ip: nil) == .unknown,
                "a loaded snapshot replaces the bundled table wholesale")
    }
}
