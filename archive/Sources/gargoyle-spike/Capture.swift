import Foundation
import CPcap
import SpikeCore

// Set from a C signal handler, so it must be a global flag.
nonisolated(unsafe) var gStopRequested: sig_atomic_t = 0

func runCapture(duration: TimeInterval?) -> Int32 {
    var errbuf = [CChar](repeating: 0, count: Int(PCAP_ERRBUF_SIZE))

    guard let pcap = pcap_create("pktap", &errbuf) else {
        fputs("pcap_create(pktap) failed: \(String(cString: errbuf))\n", stderr)
        if geteuid() != 0 {
            fputs("hint: creating the pktap interface requires root. Re-run with:\n  sudo \(CommandLine.arguments[0]) capture\n", stderr)
        }
        return 1
    }
    defer { pcap_close(pcap) }

    pcap_set_snaplen(pcap, 4096)
    pcap_set_timeout(pcap, 250)
    pcap_set_immediate_mode(pcap, 1)

    // pcap_set_want_pktap is Apple-private: without it the pktap device does
    // not deliver the metadata header. Resolve dynamically so we degrade with
    // a clear message instead of failing to link.
    typealias WantPktapFn = @convention(c) (OpaquePointer?, Int32) -> Int32
    if let sym = dlsym(dlopen(nil, RTLD_NOW), "pcap_set_want_pktap") {
        let wantPktap = unsafeBitCast(sym, to: WantPktapFn.self)
        _ = wantPktap(pcap, 1)
    } else {
        fputs("warning: pcap_set_want_pktap not found in libpcap; process attribution will be unavailable\n", stderr)
    }

    let status = pcap_activate(pcap)
    if status < 0 {
        let detail = String(cString: pcap_geterr(pcap))
        fputs("pcap_activate failed: \(String(cString: pcap_statustostr(status))) — \(detail)\n", stderr)
        if status == PCAP_ERROR_PERM_DENIED || detail.lowercased().contains("permi") {
            fputs("hint: capturing on pktap requires root. Re-run with: sudo \(CommandLine.arguments[0]) capture\n", stderr)
        }
        return 1
    }

    let dlt = pcap_datalink(pcap)
    let dltName = pcap_datalink_val_to_name(dlt).map { String(cString: $0) } ?? "\(dlt)"
    print("pktap capture active (datalink: \(dltName) [\(dlt)])")
    if dlt != GARGOYLE_DLT_PKTAP {
        fputs("warning: datalink is not DLT_PKTAP(\(GARGOYLE_DLT_PKTAP)); per-packet process metadata is missing on this kernel/libpcap\n", stderr)
    }
    if let duration {
        print(String(format: "capturing for %.0fs — generate some traffic…", duration))
    } else {
        print("capturing until Ctrl-C — generate some traffic…")
    }
    print("")

    signal(SIGINT) { _ in gStopRequested = 1 }

    let table = FlowTable()
    let deadline = duration.map { Date().addingTimeInterval($0) }
    let timeFmt = DateFormatter()
    timeFmt.dateFormat = "HH:mm:ss"

    var header: UnsafeMutablePointer<pcap_pkthdr>?
    var bytes: UnsafePointer<UInt8>?

    while gStopRequested == 0 {
        if let deadline, Date() >= deadline { break }
        let rc = pcap_next_ex(pcap, &header, &bytes)
        if rc == 0 { continue }          // read timeout: loop to re-check stop/deadline
        if rc < 0 {
            fputs("pcap_next_ex error: \(String(cString: pcap_geterr(pcap)))\n", stderr)
            break
        }
        guard let hdr = header, let raw = bytes else { continue }

        let data = Data(bytes: raw, count: Int(hdr.pointee.caplen))
        guard let record = PktapParser.parse(data) else {
            table.noteUnparsed()
            continue
        }
        guard let tuple = IPParser.flow(dlt: record.innerDLT, payload: record.payload) else {
            table.noteUnparsed()
            continue
        }

        // Original inner-packet length = wire length minus the pktap header.
        let innerLength = max(0, Int(hdr.pointee.len) - (Int(hdr.pointee.caplen) - record.payload.count))
        if let newKey = table.record(record: record, tuple: tuple, originalLength: innerLength) {
            let dir = record.isOutbound ? "out" : (record.isInbound ? "in " : "?  ")
            print(String(format: "NEW  %@  %@  %-34s %-5s %@:%d → %@:%d  %@",
                         timeFmt.string(from: Date()), dir,
                         (newKey.processLabel as NSString).utf8String!,
                         (tuple.protoName as NSString).utf8String!,
                         tuple.src, Int(tuple.sport), tuple.dst, Int(tuple.dport),
                         record.ifname))
        }
    }

    print("\n— summary ————————————————————————————————")
    print("packets seen: \(table.packetsSeen)  attributed+parsed: \(table.packetsFlowParsed)  flows: \(table.flows.count)")
    for line in table.summaryLines() { print(line) }
    return 0
}
