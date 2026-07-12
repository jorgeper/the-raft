import Foundation
import CaptureKit

/// A flow currently in progress, as shown in the UI.
public struct ActiveFlow: Sendable, Identifiable, Equatable {
    public let id: UInt64
    public let openedAt: Date
    public let pid: Int32
    public let comm: String
    public let processLabel: String
    public let displayName: String
    public let isSystem: Bool
    public let identityID: Int64?
    public let host: String?
    public let proto: UInt8
    public let src: String
    public let sport: UInt16
    public let dst: String
    public let dport: UInt16
    public let ifname: String
    public var bytesOut: Int
    public var bytesIn: Int

    public var destinationLabel: String {
        "\(host ?? dst):\(dport)"
    }
}

public enum PipelineEvent: Sendable {
    case tapStatusChanged(connected: Bool)
    case flowOpened(ActiveFlow)
    case flowUpdated(ActiveFlow)
    case flowClosed(ActiveFlow)
    /// Per-stat traffic deltas for throughput meters.
    case traffic(deltaOut: Int, deltaIn: Int, at: Date)
}

/// The tap-agnostic core (spec §2.3): consumes TapEvents, maintains active
/// flows, resolves app identities, and finalizes closed flows into the
/// hash-chained audit store. UI layers observe via `events()`.
public actor FlowPipeline {
    private let store: AuditStore
    private let resolveIdentity: @Sendable (Int32, String) -> ResolvedIdentity

    private var active: [UInt64: ActiveFlow] = [:]
    private var identityCache: [String: (id: Int64?, displayName: String, isSystem: Bool)] = [:]
    private var observers: [UUID: AsyncStream<PipelineEvent>.Continuation] = [:]
    private var tapKind: TapKind = .pcap

    public init(store: AuditStore,
                resolveIdentity: @escaping @Sendable (Int32, String) -> ResolvedIdentity
                    = { AppIdentityResolver.resolve(pid: $0, fallbackName: $1) }) {
        self.store = store
        self.resolveIdentity = resolveIdentity
    }

    // MARK: - Observation

    public func events() -> AsyncStream<PipelineEvent> {
        AsyncStream { continuation in
            let key = UUID()
            observers[key] = continuation
            continuation.onTermination = { _ in
                Task { [weak self] in await self?.removeObserver(key) }
            }
        }
    }

    private func removeObserver(_ key: UUID) {
        observers.removeValue(forKey: key)
    }

    private func emit(_ event: PipelineEvent) {
        for continuation in observers.values {
            continuation.yield(event)
        }
    }

    public var activeFlows: [ActiveFlow] {
        Array(active.values)
    }

    // MARK: - Running

    /// Consumes a tap's stream until it finishes. Call from a long-lived Task.
    public func run(tap: any FlowTap) async {
        tapKind = tap.kind
        for await connectionEvent in tap.events() {
            switch connectionEvent {
            case .connected:
                emit(.tapStatusChanged(connected: true))
            case .disconnected:
                emit(.tapStatusChanged(connected: false))
            case .event(let event):
                handle(event)
            }
        }
        try? flushAll()
    }

    private func handle(_ event: TapEvent) {
        switch event.kind {
        case .hello:
            break
        case .new:
            guard let id = event.id else { return }
            let pid = event.pid ?? 0
            let comm = event.comm ?? "?"
            let identity = cachedIdentity(pid: pid, comm: comm)
            let processLabel = Self.processLabel(pid: pid, comm: comm,
                                                 epid: event.epid, ecomm: event.ecomm)
            let flow = ActiveFlow(
                id: id,
                openedAt: event.ts.map { Date(timeIntervalSince1970: $0) } ?? Date(),
                pid: pid, comm: comm, processLabel: processLabel,
                displayName: identity.displayName, isSystem: identity.isSystem,
                identityID: identity.id,
                host: event.host, proto: event.proto ?? 0,
                src: event.src ?? "?", sport: event.sport ?? 0,
                dst: event.dst ?? "?", dport: event.dport ?? 0,
                ifname: event.ifname ?? "?",
                bytesOut: 0, bytesIn: 0)
            active[id] = flow
            emit(.flowOpened(flow))
        case .stat:
            guard let id = event.id, var flow = active[id] else { return }
            let deltaOut = event.bytesOut ?? 0
            let deltaIn = event.bytesIn ?? 0
            flow.bytesOut += deltaOut
            flow.bytesIn += deltaIn
            active[id] = flow
            emit(.flowUpdated(flow))
            emit(.traffic(deltaOut: deltaOut, deltaIn: deltaIn,
                          at: event.ts.map { Date(timeIntervalSince1970: $0) } ?? Date()))
        case .close:
            guard let id = event.id, var flow = active.removeValue(forKey: id) else { return }
            // Close carries authoritative totals.
            flow.bytesOut = event.bytesOut ?? flow.bytesOut
            flow.bytesIn = event.bytesIn ?? flow.bytesIn
            finalize(flow, closedAt: event.ts.map { Date(timeIntervalSince1970: $0) } ?? Date())
            emit(.flowClosed(flow))
        }
    }

    /// Finalizes all active flows (app quit, tap stream end).
    public func flushAll(at now: Date = Date()) throws {
        for flow in active.values {
            finalize(flow, closedAt: now)
            emit(.flowClosed(flow))
        }
        active.removeAll()
    }

    private func finalize(_ flow: ActiveFlow, closedAt: Date) {
        let draft = FlowDraft(
            openedAt: flow.openedAt, closedAt: closedAt,
            appIdentityID: flow.identityID,
            pid: flow.pid, comm: flow.comm, processLabel: flow.processLabel,
            host: flow.host, proto: flow.proto,
            src: flow.src, sport: flow.sport,
            dst: flow.dst, dport: flow.dport, ifname: flow.ifname,
            bytesOut: flow.bytesOut, bytesIn: flow.bytesIn,
            verdict: .monitored, tap: tapKind)
        do {
            try store.appendFlow(draft)
        } catch {
            // An audit write failure must not kill the capture loop; the flow
            // remains visible in the UI stream even though it wasn't persisted.
            fputs("[gargoyle] audit append failed: \(error)\n", stderr)
        }
    }

    // MARK: - Identity

    private func cachedIdentity(pid: Int32, comm: String) -> (id: Int64?, displayName: String, isSystem: Bool) {
        let key = "\(pid)|\(comm)"
        if let cached = identityCache[key] {
            return cached
        }
        let resolved = resolveIdentity(pid, comm)
        var identityID: Int64?
        do {
            identityID = try store.upsertIdentity(
                signingID: resolved.signingID, teamID: resolved.teamID,
                path: resolved.path, displayName: resolved.displayName,
                isSystem: resolved.isSystem)
        } catch {
            identityID = nil
        }
        let entry = (id: identityID, displayName: resolved.displayName, isSystem: resolved.isSystem)
        identityCache[key] = entry
        return entry
    }

    static func processLabel(pid: Int32, comm: String, epid: Int32?, ecomm: String?) -> String {
        if let epid, let ecomm, epid > 0, epid != pid, !ecomm.isEmpty, ecomm != comm {
            return "\(comm)(\(pid)) for \(ecomm)(\(epid))"
        }
        return "\(comm)(\(pid))"
    }
}
