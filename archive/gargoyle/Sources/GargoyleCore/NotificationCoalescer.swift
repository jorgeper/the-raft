import Foundation

/// Alert throttle (spec §7.4): Monitor-mode notifications coalesce per
/// app+destination so a chatty app produces one alert per window, not one
/// per connection.
public struct NotificationCoalescer: Sendable {
    private var lastNotified: [String: Date] = [:]
    private let minInterval: TimeInterval

    public init(minInterval: TimeInterval = 300) {
        self.minInterval = minInterval
    }

    public mutating func shouldNotify(app: String, destination: String, at now: Date = Date()) -> Bool {
        let key = "\(app)→\(destination)"
        if let last = lastNotified[key], now.timeIntervalSince(last) < minInterval {
            return false
        }
        lastNotified[key] = now
        // Opportunistic cleanup so long sessions don't grow unbounded.
        if lastNotified.count > 4096 {
            let cutoff = now.addingTimeInterval(-minInterval)
            lastNotified = lastNotified.filter { $0.value >= cutoff }
        }
        return true
    }
}
