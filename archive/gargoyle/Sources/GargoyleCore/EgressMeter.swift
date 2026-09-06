import Foundation

/// Ring of one-second throughput buckets backing the popover sparkline
/// (spec §7.1: 60-second egress view).
public struct EgressMeter: Sendable {
    public struct Sample: Sendable, Equatable, Identifiable {
        public var id: Int { secondsAgo }
        public let secondsAgo: Int      // 0 = current second
        public let bytesOut: Int
        public let bytesIn: Int
    }

    private var out: [Int]
    private var inn: [Int]
    private var newestSecond: Int = 0
    private let window: Int

    public init(window: Int = 60) {
        self.window = window
        out = Array(repeating: 0, count: window)
        inn = Array(repeating: 0, count: window)
    }

    public mutating func add(bytesOut: Int, bytesIn: Int, at date: Date = Date()) {
        let second = Int(date.timeIntervalSince1970)
        advance(to: second)
        out[second % window] += bytesOut
        inn[second % window] += bytesIn
    }

    /// Oldest→newest samples covering the window ending at `now`.
    public func series(now: Date = Date()) -> [Sample] {
        var copy = self
        copy.advance(to: Int(now.timeIntervalSince1970))
        return (0..<window).reversed().map { age in
            let second = copy.newestSecond - age
            return Sample(secondsAgo: age,
                          bytesOut: second >= 0 ? copy.out[second % copy.window] : 0,
                          bytesIn: second >= 0 ? copy.inn[second % copy.window] : 0)
        }
    }

    private mutating func advance(to second: Int) {
        guard second > newestSecond else { return }
        // Zero every bucket skipped since the last sample (capped by window).
        let steps = min(second - newestSecond, window)
        for i in 1...steps {
            out[(newestSecond + i) % window] = 0
            inn[(newestSecond + i) % window] = 0
        }
        newestSecond = second
    }
}
