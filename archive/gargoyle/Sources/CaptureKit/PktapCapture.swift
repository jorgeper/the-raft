import Foundation
import CPcap

public struct CaptureKitError: Error, CustomStringConvertible {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}

/// Owns a live pktap capture: pcap_create("pktap") with the Apple-private
/// want_pktap flag, delivering parsed, attributed packets one at a time.
public final class PktapCapture {
    private var pcap: OpaquePointer?
    public private(set) var datalink: Int32 = -1

    public init() {}
    deinit { close() }

    public func open(snaplen: Int32 = 4096, timeoutMs: Int32 = 250) throws {
        var errbuf = [CChar](repeating: 0, count: Int(PCAP_ERRBUF_SIZE))
        guard let p = pcap_create("pktap", &errbuf) else {
            var message = "pcap_create(pktap) failed: \(String(cString: errbuf))"
            if geteuid() != 0 { message += " — creating the pktap interface requires root" }
            throw CaptureKitError(message)
        }
        pcap_set_snaplen(p, snaplen)
        pcap_set_timeout(p, timeoutMs)
        pcap_set_immediate_mode(p, 1)

        // Apple-private: without it the pktap device does not deliver the
        // per-packet metadata header. Resolved dynamically so a missing
        // symbol degrades instead of failing to link.
        typealias WantPktapFn = @convention(c) (OpaquePointer?, Int32) -> Int32
        if let sym = dlsym(dlopen(nil, RTLD_NOW), "pcap_set_want_pktap") {
            _ = unsafeBitCast(sym, to: WantPktapFn.self)(p, 1)
        }

        let status = pcap_activate(p)
        if status < 0 {
            let detail = String(cString: pcap_geterr(p))
            pcap_close(p)
            throw CaptureKitError("pcap_activate failed: \(String(cString: pcap_statustostr(status))) — \(detail)")
        }
        pcap = p
        datalink = pcap_datalink(p)
    }

    /// Darwin reports pktap as DLT_USER2 (149); 258 is the official value.
    public var isPktapDatalink: Bool {
        datalink == GARGOYLE_DLT_PKTAP || datalink == GARGOYLE_DLT_PKTAP_DARWIN
    }

    /// Blocks up to the read timeout. Returns nil on timeout or an
    /// unparseable packet; throws on capture failure.
    public func next() throws -> (record: PktapRecord, innerLength: Int)? {
        guard let p = pcap else { throw CaptureKitError("capture is not open") }
        var header: UnsafeMutablePointer<pcap_pkthdr>?
        var bytes: UnsafePointer<UInt8>?
        let rc = pcap_next_ex(p, &header, &bytes)
        if rc == 0 { return nil }
        if rc < 0 { throw CaptureKitError("pcap_next_ex: \(String(cString: pcap_geterr(p)))") }
        guard let hdr = header, let raw = bytes else { return nil }

        let data = Data(bytes: raw, count: Int(hdr.pointee.caplen))
        guard let record = PktapParser.parse(data) else { return nil }
        // Original inner-packet length = wire length minus the pktap header.
        let innerLength = max(0, Int(hdr.pointee.len) - (Int(hdr.pointee.caplen) - record.payload.count))
        return (record, innerLength)
    }

    public func close() {
        if let p = pcap { pcap_close(p) }
        pcap = nil
    }
}
