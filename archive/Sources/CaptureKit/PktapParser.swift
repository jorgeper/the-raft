import Foundation
import CPcap

/// One packet's worth of pktap metadata plus the inner (link-layer) packet bytes.
public struct PktapRecord {
    public let pid: Int32
    public let comm: String
    public let epid: Int32
    public let ecomm: String
    public let ifname: String
    public let flags: UInt32
    public let innerDLT: UInt32
    public let payload: Data

    public var isOutbound: Bool { flags & UInt32(GARGOYLE_PTH_FLAG_DIR_OUT) != 0 }
    public var isInbound: Bool { flags & UInt32(GARGOYLE_PTH_FLAG_DIR_IN) != 0 }

    /// Human label for the responsible process. When the effective (delegate)
    /// process differs — e.g. nsurlsessiond sending on behalf of an app — show both.
    public var processLabel: String {
        if epid > 0 && epid != pid && !ecomm.isEmpty && ecomm != comm {
            return "\(comm)(\(pid)) for \(ecomm)(\(epid))"
        }
        return "\(comm)(\(pid))"
    }
}

public enum PktapParser {
    /// Parses a DLT_PKTAP packet as delivered by libpcap. Returns nil when the
    /// buffer is too short to carry the header layout we know about.
    public static func parse(_ data: Data) -> PktapRecord? {
        guard data.count >= 4 else { return nil }
        let declaredLength = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: UInt32.self) }
        let headerSize = MemoryLayout<gargoyle_pktap_header>.size
        // pth_length is the authoritative payload offset; the running kernel's
        // header may be longer than our declaration, never shorter.
        guard declaredLength >= UInt32(headerSize), data.count >= Int(declaredLength) else { return nil }

        let hdr = data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: gargoyle_pktap_header.self) }
        return PktapRecord(
            pid: hdr.pth_pid,
            comm: string(fromCCharTuple: hdr.pth_comm),
            epid: hdr.pth_epid,
            ecomm: string(fromCCharTuple: hdr.pth_ecomm),
            ifname: string(fromCCharTuple: hdr.pth_ifname),
            flags: hdr.pth_flags,
            innerDLT: hdr.pth_dlt,
            payload: data.subdata(in: Int(declaredLength)..<data.count)
        )
    }

    private static func string<T>(fromCCharTuple tuple: T) -> String {
        withUnsafeBytes(of: tuple) { raw in
            let bytes = raw.prefix(while: { $0 != 0 })
            return String(decoding: bytes, as: UTF8.self)
        }
    }
}
