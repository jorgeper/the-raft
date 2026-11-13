import Foundation
import CaptureKit
import CPcap

// gargoyle-helperd — privileged capture daemon (Tap B).
// Runs as root via launchd, captures on pktap, assembles flows, and streams
// JSON-line TapEvents to the app over a uid-restricted unix socket.
// Debug mode: `sudo gargoyle-helperd --stdout` prints events instead.

struct HelperArgs {
    var socketPath = "/var/run/gargoyle.sock"
    var allowUID: uid_t?
    var stdoutMode = false
    var idleTimeout: TimeInterval = 60

    static func parse(_ arguments: [String]) -> HelperArgs? {
        var args = HelperArgs()
        var index = 0
        while index < arguments.count {
            switch arguments[index] {
            case "--socket":
                guard index + 1 < arguments.count else { return nil }
                args.socketPath = arguments[index + 1]
                index += 1
            case "--allow-uid":
                guard index + 1 < arguments.count, let uid = uid_t(arguments[index + 1]) else { return nil }
                args.allowUID = uid
                index += 1
            case "--idle-timeout":
                guard index + 1 < arguments.count, let secs = TimeInterval(arguments[index + 1]), secs > 0 else { return nil }
                args.idleTimeout = secs
                index += 1
            case "--stdout":
                args.stdoutMode = true
            default:
                return nil
            }
            index += 1
        }
        return args
    }
}

nonisolated(unsafe) var gStop: sig_atomic_t = 0

func log(_ message: String) {
    fputs("[gargoyle-helperd] \(message)\n", stderr)
}

guard let args = HelperArgs.parse(Array(CommandLine.arguments.dropFirst())) else {
    fputs("usage: gargoyle-helperd [--socket PATH] [--allow-uid UID] [--idle-timeout SECS] [--stdout]\n", stderr)
    exit(2)
}

let dns = DNSCorrelator()
let aggregator = FlowAggregator(idleTimeout: args.idleTimeout,
                                hostnameResolver: { dns.hostname(for: $0) })

var server: TapSocketServer?
let sink: (Data) -> Void
if args.stdoutMode {
    sink = { FileHandle.standardOutput.write($0) }
} else {
    do {
        let s = try TapSocketServer(
            path: args.socketPath,
            allowUID: args.allowUID,
            helloProvider: { try? TapWire.encodeLine(.hello(version: TapWire.version, tap: "pcap")) })
        s.startAccepting()
        server = s
        sink = { [weak s] data in s?.broadcast(data) }
        log("serving on \(args.socketPath)" + (args.allowUID.map { " (uid \($0))" } ?? ""))
    } catch {
        log("failed to start socket server: \(error)")
        exit(1)
    }
}

aggregator.onEvent = { event in
    if let line = try? TapWire.encodeLine(event) {
        sink(line)
    }
}

let capture = PktapCapture()
do {
    try capture.open()
} catch {
    log("capture failed: \(error)")
    exit(1)
}
log("pktap capture active (datalink \(capture.datalink))")
if !capture.isPktapDatalink {
    log("warning: datalink is not pktap; process attribution unavailable")
}

signal(SIGINT) { _ in gStop = 1 }
signal(SIGTERM) { _ in gStop = 1 }

var lastTick = Date()
while gStop == 0 {
    do {
        if let (record, length) = try capture.next() {
            if let tuple = IPParser.flow(dlt: record.innerDLT, payload: record.payload) {
                // Feed DNS responses to the correlator before flow accounting
                // so lookups resolve by the time the answered flow opens.
                if tuple.proto == 17, tuple.sport == 53 || tuple.dport == 53,
                   let datagram = IPParser.udpPayload(dlt: record.innerDLT, payload: record.payload) {
                    dns.ingest(datagram: datagram)
                }
                aggregator.ingest(record: record, tuple: tuple, length: length)
            }
        }
    } catch {
        log("capture error: \(error)")
        break
    }
    let now = Date()
    if now.timeIntervalSince(lastTick) >= 2 {
        aggregator.tick(now: now)
        lastTick = now
    }
}

log("shutting down")
aggregator.closeAll()
capture.close()
server?.stop()
