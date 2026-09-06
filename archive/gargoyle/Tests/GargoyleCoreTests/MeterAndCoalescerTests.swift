import Testing
import Foundation
@testable import GargoyleCore

@Suite struct EgressMeterTests {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func bucketsBySecondAndReportsWindow() {
        var meter = EgressMeter(window: 5)
        meter.add(bytesOut: 100, bytesIn: 10, at: t0)
        meter.add(bytesOut: 50, bytesIn: 5, at: t0)                       // same second
        meter.add(bytesOut: 30, bytesIn: 3, at: t0.addingTimeInterval(2))

        let series = meter.series(now: t0.addingTimeInterval(2))
        #expect(series.count == 5)
        #expect(series.last?.bytesOut == 30)                              // newest
        #expect(series[series.count - 3].bytesOut == 150)                 // two seconds ago
        #expect(series.last?.secondsAgo == 0)
        #expect(series.first?.secondsAgo == 4)
    }

    @Test func staleBucketsZeroOut() {
        var meter = EgressMeter(window: 5)
        meter.add(bytesOut: 999, bytesIn: 0, at: t0)
        // Far beyond the window: everything must read zero.
        let series = meter.series(now: t0.addingTimeInterval(60))
        #expect(series.allSatisfy { $0.bytesOut == 0 })
    }

    @Test func skippedSecondsAreZeroNotStale() {
        var meter = EgressMeter(window: 5)
        meter.add(bytesOut: 100, bytesIn: 0, at: t0)
        meter.add(bytesOut: 200, bytesIn: 0, at: t0.addingTimeInterval(4))
        let series = meter.series(now: t0.addingTimeInterval(4))
        #expect(series.last?.bytesOut == 200)
        #expect(series.first?.bytesOut == 100)
        #expect(series[1].bytesOut == 0)
        #expect(series[2].bytesOut == 0)
    }
}

@Suite struct NotificationCoalescerTests {
    private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func throttlesPerAppDestinationPair() {
        var coalescer = NotificationCoalescer(minInterval: 300)
        let first = coalescer.shouldNotify(app: "Slack", destination: "slack.com", at: t0)
        let repeated = coalescer.shouldNotify(app: "Slack", destination: "slack.com", at: t0.addingTimeInterval(60))
        // Different destination or app: independent throttles.
        let otherDest = coalescer.shouldNotify(app: "Slack", destination: "telemetry.slack.com", at: t0)
        let otherApp = coalescer.shouldNotify(app: "Zoom", destination: "slack.com", at: t0)
        // Window elapsed: fires again.
        let afterWindow = coalescer.shouldNotify(app: "Slack", destination: "slack.com", at: t0.addingTimeInterval(301))

        #expect(first)
        #expect(!repeated)
        #expect(otherDest)
        #expect(otherApp)
        #expect(afterWindow)
    }
}
