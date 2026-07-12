import Foundation

public struct FlowTuple: Hashable {
    public let proto: UInt8
    public let src: String
    public let sport: UInt16
    public let dst: String
    public let dport: UInt16

    public init(proto: UInt8, src: String, sport: UInt16, dst: String, dport: UInt16) {
        self.proto = proto
        self.src = src
        self.sport = sport
        self.dst = dst
        self.dport = dport
    }

    public var protoName: String {
        switch proto {
        case 1: return "ICMP"
        case 6: return "TCP"
        case 17: return "UDP"
        case 58: return "ICMP6"
        default: return "IP(\(proto))"
        }
    }
}

/// Extracts a 5-tuple from an inner packet, dispatching on the pktap-reported DLT.
public enum IPParser {
    static let DLT_NULL: UInt32 = 0
    static let DLT_EN10MB: UInt32 = 1
    static let DLT_RAW: UInt32 = 12
    static let DLT_LOOP: UInt32 = 108

    public static func flow(dlt: UInt32, payload: Data) -> FlowTuple? {
        guard let ip = ipData(dlt: dlt, payload: payload), let first = ip.first else { return nil }
        return (first >> 4) == 6 ? ipv6Flow(ip) : ipv4Flow(ip)
    }

    /// For UDP packets, the datagram payload after the 8-byte UDP header
    /// (used for DNS correlation). Nil for anything else.
    public static func udpPayload(dlt: UInt32, payload: Data) -> Data? {
        guard let ip = ipData(dlt: dlt, payload: payload), let first = ip.first else { return nil }
        let base = ip.startIndex
        let transport: Data
        if first >> 4 == 4 {
            guard ip.count >= 20 else { return nil }
            let ihl = Int(ip[base] & 0x0F) * 4
            guard ihl >= 20, ip.count >= ihl, ip[base + 9] == 17 else { return nil }
            transport = ip.dropFirst(ihl)
        } else if first >> 4 == 6 {
            guard ip.count >= 40, ip[base + 6] == 17 else { return nil }
            transport = ip.dropFirst(40)
        } else {
            return nil
        }
        guard transport.count > 8 else { return nil }
        return transport.dropFirst(8)
    }

    /// Strips the link-layer framing indicated by the pktap-reported DLT,
    /// returning the IP packet.
    private static func ipData(dlt: UInt32, payload: Data) -> Data? {
        switch dlt {
        case DLT_EN10MB:
            guard payload.count >= 14 else { return nil }
            let etherType = UInt16(payload[payload.startIndex + 12]) << 8 | UInt16(payload[payload.startIndex + 13])
            guard etherType == 0x0800 || etherType == 0x86DD else { return nil }
            return payload.dropFirst(14)
        case DLT_NULL, DLT_LOOP:
            guard payload.count >= 4 else { return nil }
            // 4-byte address family in host byte order.
            let af = payload.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: UInt32.self) }
            guard af == UInt32(AF_INET) || af == UInt32(AF_INET6) || af == 24 || af == 28 else { return nil }
            return payload.dropFirst(4)
        case DLT_RAW:
            return payload.isEmpty ? nil : payload
        default:
            // Unknown link type: sniff the IP version nibble as a last resort.
            guard let first = payload.first, first >> 4 == 4 || first >> 4 == 6 else { return nil }
            return payload
        }
    }

    private static func ipv4Flow(_ data: Data) -> FlowTuple? {
        guard data.count >= 20 else { return nil }
        let base = data.startIndex
        guard data[base] >> 4 == 4 else { return nil }
        let ihl = Int(data[base] & 0x0F) * 4
        guard ihl >= 20, data.count >= ihl else { return nil }
        let proto = data[base + 9]
        let src = ipv4String(data, offset: 12)
        let dst = ipv4String(data, offset: 16)
        let (sport, dport) = ports(proto: proto, transport: data.dropFirst(ihl))
        return FlowTuple(proto: proto, src: src, sport: sport, dst: dst, dport: dport)
    }

    private static func ipv6Flow(_ data: Data) -> FlowTuple? {
        guard data.count >= 40 else { return nil }
        let base = data.startIndex
        guard data[base] >> 4 == 6 else { return nil }
        // Extension headers are not walked in the spike; ports only for
        // directly-following TCP/UDP.
        let proto = data[base + 6]
        let src = ipv6String(data, offset: 8)
        let dst = ipv6String(data, offset: 24)
        let (sport, dport) = ports(proto: proto, transport: data.dropFirst(40))
        return FlowTuple(proto: proto, src: src, sport: sport, dst: dst, dport: dport)
    }

    private static func ports(proto: UInt8, transport: Data) -> (UInt16, UInt16) {
        guard proto == 6 || proto == 17, transport.count >= 4 else { return (0, 0) }
        let base = transport.startIndex
        let sport = UInt16(transport[base]) << 8 | UInt16(transport[base + 1])
        let dport = UInt16(transport[base + 2]) << 8 | UInt16(transport[base + 3])
        return (sport, dport)
    }

    private static func ipv4String(_ data: Data, offset: Int) -> String {
        let base = data.startIndex + offset
        return "\(data[base]).\(data[base + 1]).\(data[base + 2]).\(data[base + 3])"
    }

    private static func ipv6String(_ data: Data, offset: Int) -> String {
        var addr = in6_addr()
        _ = withUnsafeMutableBytes(of: &addr) { dest in
            data.dropFirst(offset).prefix(16).copyBytes(to: dest)
        }
        var buf = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
        var addrCopy = addr
        guard inet_ntop(AF_INET6, &addrCopy, &buf, socklen_t(buf.count)) != nil else { return "?" }
        return String(cString: buf)
    }
}
