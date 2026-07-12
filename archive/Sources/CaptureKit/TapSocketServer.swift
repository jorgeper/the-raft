import Foundation

/// Broadcast server for the tap event stream: a unix-domain socket restricted
/// to one uid, JSON lines out, no input expected from clients. Slow or dead
/// clients are disconnected rather than allowed to stall the capture loop.
public final class TapSocketServer {
    private let listenFD: Int32
    private let path: String
    private let helloProvider: () -> Data?
    private let lock = NSLock()
    private var clients: [Int32] = []
    private var acceptSource: DispatchSourceRead?

    public init(path: String, allowUID: uid_t? = nil,
                helloProvider: @escaping () -> Data? = { nil }) throws {
        self.path = path
        self.helloProvider = helloProvider

        unlink(path)
        listenFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listenFD >= 0 else { throw CaptureKitError("socket(): \(String(cString: strerror(errno)))") }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let pathBytes = Array(path.utf8)
        let copied = withUnsafeMutableBytes(of: &addr.sun_path) { raw -> Bool in
            guard pathBytes.count < raw.count else { return false }
            raw.copyBytes(from: pathBytes)
            return true
        }
        guard copied else {
            Darwin.close(listenFD)
            throw CaptureKitError("socket path too long: \(path)")
        }
        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(listenFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindResult == 0 else {
            let err = String(cString: strerror(errno))
            Darwin.close(listenFD)
            throw CaptureKitError("bind(\(path)): \(err)")
        }
        chmod(path, 0o600)
        if let uid = allowUID { chown(path, uid, .max) }
        guard listen(listenFD, 4) == 0 else {
            let err = String(cString: strerror(errno))
            Darwin.close(listenFD)
            throw CaptureKitError("listen(): \(err)")
        }
    }

    public func startAccepting() {
        let source = DispatchSource.makeReadSource(fileDescriptor: listenFD, queue: .global())
        source.setEventHandler { [weak self] in
            guard let self else { return }
            let fd = accept(self.listenFD, nil, nil)
            guard fd >= 0 else { return }
            var one: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
            _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
            if let hello = self.helloProvider() {
                _ = hello.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
            }
            self.lock.lock()
            self.clients.append(fd)
            self.lock.unlock()
        }
        source.resume()
        acceptSource = source
    }

    public var clientCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return clients.count
    }

    /// Sends one framed line to every client. A client that cannot take the
    /// whole line immediately (or errors) is dropped: framing integrity
    /// beats completeness for a monitoring stream.
    public func broadcast(_ data: Data) {
        lock.lock()
        let fds = clients
        lock.unlock()

        var dead: [Int32] = []
        for fd in fds {
            let written = data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
            if written != data.count { dead.append(fd) }
        }
        if !dead.isEmpty {
            lock.lock()
            clients.removeAll { dead.contains($0) }
            lock.unlock()
            dead.forEach { Darwin.close($0) }
        }
    }

    public func stop() {
        acceptSource?.cancel()
        acceptSource = nil
        lock.lock()
        let fds = clients
        clients = []
        lock.unlock()
        fds.forEach { Darwin.close($0) }
        Darwin.close(listenFD)
        unlink(path)
    }
}
