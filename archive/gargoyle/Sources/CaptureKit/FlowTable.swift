import Foundation

/// Aggregates packets into flows keyed by (process, 5-tuple) and reports
/// first sightings so the capture loop can print new flows live.
public final class FlowTable {
    public struct Key: Hashable {
        public let processLabel: String
        public let tuple: FlowTuple
    }

    public struct Stats {
        public var packets: Int = 0
        public var bytesOut: Int = 0
        public var bytesIn: Int = 0
        public var ifname: String = ""
        public var firstSeen: Date
    }

    public private(set) var flows: [Key: Stats] = [:]
    public private(set) var packetsSeen = 0
    public private(set) var packetsAttributed = 0
    public private(set) var packetsFlowParsed = 0

    public init() {}

    /// Records one packet; returns the key iff this is the first packet of its flow.
    @discardableResult
    public func record(record: PktapRecord, tuple: FlowTuple, originalLength: Int, at date: Date = Date()) -> Key? {
        packetsSeen += 1
        if record.pid > 0 || !record.comm.isEmpty { packetsAttributed += 1 }
        packetsFlowParsed += 1

        let key = Key(processLabel: record.processLabel, tuple: tuple)
        let isNew = flows[key] == nil
        var stats = flows[key] ?? Stats(firstSeen: date)
        stats.packets += 1
        stats.ifname = record.ifname
        if record.isOutbound {
            stats.bytesOut += originalLength
        } else {
            stats.bytesIn += originalLength
        }
        flows[key] = stats
        return isNew ? key : nil
    }

    public func noteUnparsed() { packetsSeen += 1 }

    /// Per-process rollup sorted by total bytes, for the exit summary.
    public func summaryLines() -> [String] {
        struct Agg { var flows = 0; var bytesOut = 0; var bytesIn = 0; var dests = Set<String>() }
        var byProcess: [String: Agg] = [:]
        for (key, stats) in flows {
            var agg = byProcess[key.processLabel] ?? Agg()
            agg.flows += 1
            agg.bytesOut += stats.bytesOut
            agg.bytesIn += stats.bytesIn
            agg.dests.insert("\(key.tuple.dst):\(key.tuple.dport)")
            byProcess[key.processLabel] = agg
        }
        return byProcess
            .sorted { ($0.value.bytesOut + $0.value.bytesIn) > ($1.value.bytesOut + $1.value.bytesIn) }
            .map { label, agg in
                let out = Self.humanBytes(agg.bytesOut)
                let inn = Self.humanBytes(agg.bytesIn)
                return String(format: "%-40s %4d flows  %4d dests  out %8s  in %8s",
                              (label as NSString).utf8String!, agg.flows, agg.dests.count,
                              (out as NSString).utf8String!, (inn as NSString).utf8String!)
            }
    }

    public static func humanBytes(_ n: Int) -> String {
        let units = ["B", "KB", "MB", "GB"]
        var value = Double(n)
        var unit = 0
        while value >= 1024, unit < units.count - 1 {
            value /= 1024
            unit += 1
        }
        return unit == 0 ? "\(n)B" : String(format: "%.1f%@", value, units[unit])
    }
}
