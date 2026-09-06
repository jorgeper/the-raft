import Testing
import Foundation
import CaptureKit
@testable import GargoyleCore

@Suite struct PcapTapIntegrationTests {
    /// Full round trip over a real unix socket: connect → hello → broadcast
    /// events → server shutdown → disconnected signal.
    @Test(.timeLimit(.minutes(1))) func streamsEventsOverSocket() async throws {
        let path = NSTemporaryDirectory() + "gg-\(UInt32.random(in: 0..<UInt32.max)).sock"
        let server = try TapSocketServer(
            path: path,
            helloProvider: { try? TapWire.encodeLine(.hello(version: TapWire.version, tap: "pcap")) })
        server.startAccepting()
        defer { unlink(path) }

        let tap = PcapTap(socketPath: path, reconnectDelay: 0.1)
        var log: [String] = []

        loop: for await connectionEvent in tap.events() {
            switch connectionEvent {
            case .connected:
                log.append("connected")
            case .event(let event):
                log.append(event.kind.rawValue)
                switch event.kind {
                case .hello:
                    #expect(event.version == TapWire.version)
                    #expect(event.tap == "pcap")
                    var new = TapEvent(kind: .new)
                    new.id = 7
                    new.comm = "curl"
                    new.dst = "1.2.3.4"
                    server.broadcast(try TapWire.encodeLine(new))
                case .new:
                    #expect(event.id == 7)
                    #expect(event.comm == "curl")
                    var stat = TapEvent(kind: .stat)
                    stat.id = 7
                    stat.bytesOut = 100
                    server.broadcast(try TapWire.encodeLine(stat))
                case .stat:
                    #expect(event.bytesOut == 100)
                    server.stop()
                case .close:
                    break
                }
            case .disconnected:
                log.append("disconnected")
                break loop
            }
        }
        tap.stop()

        #expect(log == ["connected", "hello", "new", "stat", "disconnected"])
    }

    /// The tap must keep retrying until the socket exists (helper may start
    /// after the app).
    @Test(.timeLimit(.minutes(1))) func reconnectsWhenServerAppearsLate() async throws {
        let path = NSTemporaryDirectory() + "gg-\(UInt32.random(in: 0..<UInt32.max)).sock"
        let tap = PcapTap(socketPath: path, reconnectDelay: 0.05)
        defer { unlink(path) }

        let stream = tap.events()
        // Start the server only after the tap has begun retrying.
        try await Task.sleep(nanoseconds: 200_000_000)
        let server = try TapSocketServer(
            path: path,
            helloProvider: { try? TapWire.encodeLine(.hello(version: TapWire.version, tap: "pcap")) })
        server.startAccepting()

        var sawHello = false
        loop: for await connectionEvent in stream {
            if case .event(let event) = connectionEvent, event.kind == .hello {
                sawHello = true
                break loop
            }
        }
        tap.stop()
        server.stop()
        #expect(sawHello)
    }
}
