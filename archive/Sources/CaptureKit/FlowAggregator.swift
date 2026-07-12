import Foundation

/// Assembles attributed packets into bidirectional flows and emits wire events:
/// `new` on first sight, `stat` deltas on tick, `close` (with totals) on idle
/// timeout. Both directions of a connection map to one flow keyed on the
/// outbound-oriented tuple plus the owning process.
public final class FlowAggregator {
    public struct Key: Hashable {
        let pid: Int32
        let comm: String
        let tuple: FlowTuple      // canonical: oriented outbound
    }

    private struct State {
        let id: UInt64
        let record: PktapRecord
        let tuple: FlowTuple
        var pendingOut = 0
        var pendingIn = 0
        var totalOut = 0
        var totalIn = 0
        var lastSeen: Date
    }

    public var onEvent: ((TapEvent) -> Void)?

    private var flows: [Key: State] = [:]
    private var nextID: UInt64 = 1
    private let idleTimeout: TimeInterval
    private let hostnameResolver: (String) -> String?

    public init(idleTimeout: TimeInterval = 60,
                hostnameResolver: @escaping (String) -> String? = { _ in nil }) {
        self.idleTimeout = idleTimeout
        self.hostnameResolver = hostnameResolver
    }

    /// Ingest one attributed, parsed packet.
    public func ingest(record: PktapRecord, tuple: FlowTuple, length: Int, at now: Date = Date()) {
        // Canonicalize: an inbound packet belongs to the flow keyed on its
        // reversed tuple, so replies merge with the outbound side.
        let outbound = !record.isInbound
        let canonical = outbound ? tuple : FlowTuple(
            proto: tuple.proto, src: tuple.dst, sport: tuple.dport,
            dst: tuple.src, dport: tuple.sport)
        let key = Key(pid: record.pid, comm: record.comm, tuple: canonical)

        if flows[key] == nil {
            let id = nextID
            nextID += 1
            flows[key] = State(id: id, record: record, tuple: canonical, lastSeen: now)

            var event = TapEvent(kind: .new)
            event.ts = now.timeIntervalSince1970
            event.id = id
            event.pid = record.pid
            event.comm = record.comm
            event.epid = record.epid
            event.ecomm = record.ecomm
            event.proto = canonical.proto
            event.src = canonical.src
            event.sport = canonical.sport
            event.dst = canonical.dst
            event.dport = canonical.dport
            event.host = hostnameResolver(canonical.dst)
            event.ifname = record.ifname
            onEvent?(event)
        }

        flows[key]!.lastSeen = now
        if outbound {
            flows[key]!.pendingOut += length
            flows[key]!.totalOut += length
        } else {
            flows[key]!.pendingIn += length
            flows[key]!.totalIn += length
        }
    }

    /// Flush stat deltas and close idle flows. Call periodically (~2s).
    public func tick(now: Date = Date()) {
        for (key, state) in flows {
            if state.pendingOut > 0 || state.pendingIn > 0 {
                var event = TapEvent(kind: .stat)
                event.ts = now.timeIntervalSince1970
                event.id = state.id
                event.bytesOut = state.pendingOut
                event.bytesIn = state.pendingIn
                onEvent?(event)
                flows[key]!.pendingOut = 0
                flows[key]!.pendingIn = 0
            }
            if now.timeIntervalSince(state.lastSeen) >= idleTimeout {
                close(key: key, at: now)
            }
        }
    }

    /// Close everything (helper shutdown).
    public func closeAll(at now: Date = Date()) {
        for key in Array(flows.keys) {
            close(key: key, at: now)
        }
    }

    private func close(key: Key, at now: Date) {
        guard let state = flows.removeValue(forKey: key) else { return }
        var event = TapEvent(kind: .close)
        event.ts = now.timeIntervalSince1970
        event.id = state.id
        event.bytesOut = state.totalOut
        event.bytesIn = state.totalIn
        onEvent?(event)
    }
}
