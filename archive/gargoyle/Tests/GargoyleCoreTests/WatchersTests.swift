import Testing
import Foundation
@testable import GargoyleCore

private let now = Date(timeIntervalSince1970: 1_700_000_000)

@Suite struct PersistenceWatcherTests {
    @Test func detectsNewPersistenceItems() {
        let before = PersistenceSnapshot(items: ["/Library/LaunchAgents/a.plist": "100-1"])
        let after = PersistenceSnapshot(items: [
            "/Library/LaunchAgents/a.plist": "100-1",
            "/Library/LaunchDaemons/evil.plist": "42-2",
        ])
        let events = before.diff(against: after, at: now)
        #expect(events.count == 1)
        #expect(events[0].kind == .persistenceAdded)
        #expect(events[0].detail == "/Library/LaunchDaemons/evil.plist")
    }

    @Test func detectsModifiedItems() {
        let before = PersistenceSnapshot(items: ["/Library/LaunchAgents/a.plist": "100-1"])
        let after = PersistenceSnapshot(items: ["/Library/LaunchAgents/a.plist": "150-9"])
        let events = before.diff(against: after, at: now)
        #expect(events.count == 1)
        #expect(events[0].kind == .persistenceChanged)
    }

    /// Removing a launch agent is good news, not an alert.
    @Test func removalIsNotAlerted() {
        let before = PersistenceSnapshot(items: ["/Library/LaunchAgents/a.plist": "100-1"])
        let after = PersistenceSnapshot(items: [:])
        #expect(before.diff(against: after, at: now).isEmpty)
    }

    @Test func steadyStateIsQuiet() {
        let snapshot = PersistenceSnapshot(items: ["/Library/LaunchAgents/a.plist": "100-1"])
        #expect(snapshot.diff(against: snapshot, at: now).isEmpty)
    }

    /// The real scanner reads a directory and fingerprints its plists.
    @Test func scanFingerprintsPlistsOnDisk() throws {
        let dir = NSTemporaryDirectory() + "gg-persist-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        try Data("x".utf8).write(to: URL(fileURLWithPath: dir + "/com.example.agent.plist"))
        try Data("y".utf8).write(to: URL(fileURLWithPath: dir + "/notes.txt"))

        let snapshot = PersistenceWatcher.scan(paths: [dir])
        #expect(snapshot.items.count == 1, "only .plist entries count as persistence")
        #expect(snapshot.items.keys.first?.hasSuffix("com.example.agent.plist") == true)
    }
}

@Suite struct QuarantineWatcherTests {
    /// `0081;5f3a1b2c;Safari;UUID` — field 2 is a hex epoch.
    @Test func parsesQuarantineTimestamp() throws {
        let date = try #require(QuarantineWatcher.parseQuarantineValue("0081;5f3a1b2c;Safari;ABC-123"))
        #expect(Int(date.timeIntervalSince1970) == 0x5f3a1b2c)
        #expect(QuarantineWatcher.parseQuarantineValue("garbage") == nil)
        #expect(QuarantineWatcher.parseQuarantineValue("0081") == nil)
    }

    @Test func flagsFreshlyDownloadedAppOnFirstEgress() throws {
        let downloaded = now.addingTimeInterval(-600)   // 10 minutes ago
        let watcher = QuarantineWatcher(window: 3600, quarantineDate: { _ in downloaded })

        let event = try #require(watcher.check(path: "/Applications/New.app", appName: "New",
                                               destination: "unknown.example:443", now: now))
        #expect(event.kind == .quarantinedAppPhonedHome)
        #expect(event.detail.contains("New"))
        #expect(event.detail.contains("10m ago"))
    }

    @Test func ignoresOldDownloadsAndUnquarantinedApps() {
        let stale = QuarantineWatcher(window: 3600,
                                      quarantineDate: { _ in now.addingTimeInterval(-7200) })
        #expect(stale.check(path: "/Applications/Old.app", appName: "Old",
                            destination: "x:443", now: now) == nil,
                "outside the window: no longer the 'just installed' moment")

        let clean = QuarantineWatcher(window: 3600, quarantineDate: { _ in nil })
        #expect(clean.check(path: "/Applications/Trusted.app", appName: "Trusted",
                            destination: "x:443", now: now) == nil)
        #expect(clean.check(path: nil, appName: "Unsigned", destination: "x:443", now: now) == nil)
    }
}

@Suite struct AVUsageWatcherTests {
    @Test func parsesCameraStart() throws {
        let line = "2026-07-12 10:00:00.000 Df cmiod[123]: camera capture start client=com.example.zoom"
        let event = try #require(AVUsageWatcher.parse(line: line, now: now))
        #expect(event.kind == .cameraUsed)
        #expect(event.detail == "com.example.zoom")
    }

    @Test func parsesMicrophoneStart() throws {
        let line = "coreaudiod: microphone active attribution=com.example.recorder"
        let event = try #require(AVUsageWatcher.parse(line: line, now: now))
        #expect(event.kind == .micUsed)
        #expect(event.detail == "com.example.recorder")
    }

    @Test func ignoresUnrelatedAndStopLines() {
        #expect(AVUsageWatcher.parse(line: "networkd: route change", now: now) == nil)
        #expect(AVUsageWatcher.parse(line: "camera stopped client=com.example.zoom", now: now) == nil,
                "a stop event is not an alert")
        #expect(AVUsageWatcher.parse(line: "camera capture start", now: now) == nil,
                "no attributable client: nothing useful to report")
    }

    @Test func extractsClientFromSeveralShapes() {
        #expect(AVUsageWatcher.extractClient(from: "x client=com.a.b y") == "com.a.b")
        #expect(AVUsageWatcher.extractClient(from: "bundleID=com.c.d,") == "com.c.d")
        #expect(AVUsageWatcher.extractClient(from: "no client here") == nil)
    }
}
