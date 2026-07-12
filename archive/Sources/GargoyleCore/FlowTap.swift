import Foundation
import CaptureKit

/// Connection-level events from a tap. Everything downstream of a `FlowTap`
/// is tap-agnostic (spec §2.2): PcapTap (Tap B) today, FilterTap (Tap A) in
/// Phase 2, MockTap for tests and UI development.
public enum TapConnectionEvent: Sendable, Equatable {
    case connected
    case disconnected
    case event(TapEvent)
}

public protocol FlowTap: Sendable {
    var kind: TapKind { get }
    /// Long-lived event stream. Implementations reconnect internally and
    /// signal availability via connected/disconnected.
    func events() -> AsyncStream<TapConnectionEvent>
    func stop()
}

/// Replays a scripted event sequence: drives the pipeline in tests and the
/// whole app in mock mode (GARGOYLE_MOCK_TAP=1), no root required.
public final class MockTap: FlowTap, @unchecked Sendable {
    public let kind = TapKind.pcap
    private let script: [(delay: TimeInterval, event: TapConnectionEvent)]
    private let loops: Bool
    private var task: Task<Void, Never>?

    public init(script: [(delay: TimeInterval, event: TapConnectionEvent)], loops: Bool = false) {
        self.script = script
        self.loops = loops
    }

    public func events() -> AsyncStream<TapConnectionEvent> {
        AsyncStream { continuation in
            let task = Task { [script, loops] in
                continuation.yield(.connected)
                repeat {
                    for step in script {
                        if step.delay > 0 {
                            try? await Task.sleep(nanoseconds: UInt64(step.delay * 1_000_000_000))
                        }
                        if Task.isCancelled { break }
                        continuation.yield(step.event)
                    }
                } while loops && !Task.isCancelled
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
            self.task = task
        }
    }

    public func stop() { task?.cancel() }
}
