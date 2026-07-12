import Foundation
import CaptureKit

/// Tap B client: consumes the gargoyle-helperd event stream over its
/// uid-restricted unix socket, reconnecting until stopped.
public final class PcapTap: FlowTap, @unchecked Sendable {
    public static let defaultSocketPath = "/var/run/gargoyle.sock"

    public let kind = TapKind.pcap
    private let socketPath: String
    private let reconnectDelay: TimeInterval
    private let taskLock = NSLock()
    private var task: Task<Void, Never>?

    public init(socketPath: String = PcapTap.defaultSocketPath,
                reconnectDelay: TimeInterval = 3) {
        self.socketPath = socketPath
        self.reconnectDelay = reconnectDelay
    }

    public func events() -> AsyncStream<TapConnectionEvent> {
        AsyncStream { continuation in
            let task = Task.detached { [socketPath, reconnectDelay] in
                while !Task.isCancelled {
                    let fd = Self.connectSocket(path: socketPath)
                    if fd < 0 {
                        try? await Task.sleep(nanoseconds: UInt64(reconnectDelay * 1_000_000_000))
                        continue
                    }
                    continuation.yield(.connected)
                    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
                    do {
                        for try await line in handle.bytes.lines {
                            if Task.isCancelled { break }
                            if let event = try? TapWire.decode(line: Data(line.utf8)) {
                                continuation.yield(.event(event))
                            }
                        }
                    } catch {
                        // fall through to disconnected
                    }
                    continuation.yield(.disconnected)
                    try? handle.close()
                    if !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: UInt64(reconnectDelay * 1_000_000_000))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
            taskLock.lock()
            self.task = task
            taskLock.unlock()
        }
    }

    public func stop() {
        taskLock.lock()
        task?.cancel()
        taskLock.unlock()
    }

    private static func connectSocket(path: String) -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return -1 }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8)
        let copied = withUnsafeMutableBytes(of: &addr.sun_path) { raw -> Bool in
            guard pathBytes.count < raw.count else { return false }
            raw.copyBytes(from: pathBytes)
            return true
        }
        guard copied else {
            Darwin.close(fd)
            return -1
        }
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard rc == 0 else {
            Darwin.close(fd)
            return -1
        }
        return fd
    }
}
