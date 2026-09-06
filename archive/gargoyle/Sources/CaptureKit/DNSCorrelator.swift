import Foundation

/// Passive DNS: parses response datagrams observed on the wire and remembers
/// which query name each answered IP belongs to, so flows can be labeled with
/// hostnames (spec §2.3 "DNS-correlated"). All answer addresses map to the
/// original question name — that collapses CNAME chains to the name the user
/// would recognize.
public final class DNSCorrelator {
    private var ipToName: [String: String] = [:]
    private var insertionOrder: [String] = []
    private let capacity: Int

    public init(capacity: Int = 8192) {
        self.capacity = capacity
    }

    public func hostname(for ip: String) -> String? {
        ipToName[ip]
    }

    /// Feed one UDP datagram payload that might be a DNS response.
    public func ingest(datagram: Data) {
        guard let message = Self.parseResponse(datagram) else { return }
        for ip in message.addresses {
            if ipToName[ip] == nil {
                insertionOrder.append(ip)
                if insertionOrder.count > capacity {
                    ipToName.removeValue(forKey: insertionOrder.removeFirst())
                }
            }
            ipToName[ip] = message.queryName
        }
    }

    // MARK: - DNS message parsing

    struct Response {
        var queryName: String
        var addresses: [String]
    }

    static func parseResponse(_ data: Data) -> Response? {
        let bytes = [UInt8](data)
        guard bytes.count >= 12 else { return nil }
        let flags = UInt16(bytes[2]) << 8 | UInt16(bytes[3])
        guard flags & 0x8000 != 0 else { return nil }          // QR=1: response
        guard flags & 0x000F == 0 else { return nil }          // RCODE=0
        let qdCount = Int(bytes[4]) << 8 | Int(bytes[5])
        let anCount = Int(bytes[6]) << 8 | Int(bytes[7])
        guard qdCount >= 1, anCount >= 1 else { return nil }

        var offset = 12
        guard let (queryName, afterQName) = parseName(bytes, at: offset) else { return nil }
        offset = afterQName + 4                                 // qtype + qclass
        // Skip any additional questions.
        for _ in 1..<qdCount {
            guard let (_, next) = parseName(bytes, at: offset) else { return nil }
            offset = next + 4
        }

        var addresses: [String] = []
        for _ in 0..<anCount {
            guard let (_, afterName) = parseName(bytes, at: offset) else { break }
            offset = afterName
            guard offset + 10 <= bytes.count else { break }
            let type = UInt16(bytes[offset]) << 8 | UInt16(bytes[offset + 1])
            let rdLength = Int(bytes[offset + 8]) << 8 | Int(bytes[offset + 9])
            offset += 10
            guard offset + rdLength <= bytes.count else { break }
            switch type {
            case 1 where rdLength == 4:                         // A
                addresses.append("\(bytes[offset]).\(bytes[offset+1]).\(bytes[offset+2]).\(bytes[offset+3])")
            case 28 where rdLength == 16:                       // AAAA
                var addr = in6_addr()
                withUnsafeMutableBytes(of: &addr) { dest in
                    dest.copyBytes(from: bytes[offset..<offset+16])
                }
                var buf = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
                if inet_ntop(AF_INET6, &addr, &buf, socklen_t(buf.count)) != nil {
                    addresses.append(String(cString: buf))
                }
            default:                                            // CNAME etc: skip
                break
            }
            offset += rdLength
        }
        guard !addresses.isEmpty else { return nil }
        return Response(queryName: queryName, addresses: addresses)
    }

    /// Parses a possibly-compressed DNS name. Returns the name and the offset
    /// just past its encoding at the original position.
    static func parseName(_ bytes: [UInt8], at start: Int) -> (String, Int)? {
        var labels: [String] = []
        var offset = start
        var endOffset: Int? = nil       // set at the first compression pointer
        var jumps = 0

        while true {
            guard offset < bytes.count else { return nil }
            let length = Int(bytes[offset])
            if length == 0 {
                if endOffset == nil { endOffset = offset + 1 }
                break
            }
            if length & 0xC0 == 0xC0 {                          // compression pointer
                guard offset + 1 < bytes.count else { return nil }
                let target = (length & 0x3F) << 8 | Int(bytes[offset + 1])
                if endOffset == nil { endOffset = offset + 2 }
                jumps += 1
                guard jumps <= 32, target < offset else { return nil }  // forward pointers are invalid
                offset = target
                continue
            }
            guard length <= 63, offset + 1 + length <= bytes.count else { return nil }
            let label = bytes[(offset + 1)...(offset + length)]
            labels.append(String(decoding: label, as: UTF8.self).lowercased())
            offset += 1 + length
            guard labels.count <= 127 else { return nil }
        }
        guard !labels.isEmpty else { return nil }
        return (labels.joined(separator: "."), endOffset!)
    }
}
