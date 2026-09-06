import Testing
import Foundation
import CPcap
@testable import CaptureKit

// MARK: - Fixtures

/// Builds a wire-format pktap packet: header (layout from CPcap) + inner packet.
func makePktapPacket(
    pid: Int32, comm: String, epid: Int32 = 0, ecomm: String = "",
    ifname: String = "en0", flags: UInt32 = UInt32(GARGOYLE_PTH_FLAG_DIR_OUT),
    dlt: UInt32, inner: Data
) -> Data {
    let headerSize = MemoryLayout<gargoyle_pktap_header>.size
    var header = Data(count: headerSize)
    func put<T>(_ value: T, at offset: Int) {
        withUnsafeBytes(of: value) { header.replaceSubrange(offset..<offset + $0.count, with: $0) }
    }
    func putString(_ s: String, at offset: Int, max: Int) {
        let bytes = Array(s.utf8.prefix(max - 1))
        header.replaceSubrange(offset..<offset + bytes.count, with: bytes)
    }
    put(UInt32(headerSize), at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_length)!)
    put(dlt, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_dlt)!)
    putString(ifname, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_ifname)!, max: Int(GARGOYLE_PKTAP_IFXNAMESIZE))
    put(flags, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_flags)!)
    put(pid, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_pid)!)
    putString(comm, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_comm)!, max: Int(GARGOYLE_MAXCOMLEN) + 1)
    put(epid, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_epid)!)
    putString(ecomm, at: MemoryLayout.offset(of: \gargoyle_pktap_header.pth_ecomm)!, max: Int(GARGOYLE_MAXCOMLEN) + 1)
    return header + inner
}

/// Minimal IPv4+TCP packet builder.
func makeIPv4TCP(src: [UInt8] = [10, 0, 0, 5], sport: UInt16 = 54321,
                 dst: [UInt8] = [93, 184, 216, 34], dport: UInt16 = 443,
                 payload: Data = Data()) -> Data {
    var ip = Data(count: 20)
    ip[0] = 0x45                               // v4, IHL 5
    ip[9] = 6                                  // TCP
    ip.replaceSubrange(12..<16, with: src)
    ip.replaceSubrange(16..<20, with: dst)
    var tcp = Data(count: 20)
    tcp[0] = UInt8(sport >> 8); tcp[1] = UInt8(sport & 0xFF)
    tcp[2] = UInt8(dport >> 8); tcp[3] = UInt8(dport & 0xFF)
    return ip + tcp + payload
}

/// Minimal IPv4+UDP packet builder.
func makeIPv4UDP(src: [UInt8] = [10, 0, 0, 5], sport: UInt16 = 59665,
                 dst: [UInt8] = [8, 8, 8, 8], dport: UInt16 = 53,
                 payload: Data = Data()) -> Data {
    var ip = Data(count: 20)
    ip[0] = 0x45
    ip[9] = 17
    ip.replaceSubrange(12..<16, with: src)
    ip.replaceSubrange(16..<20, with: dst)
    var udp = Data(count: 8)
    udp[0] = UInt8(sport >> 8); udp[1] = UInt8(sport & 0xFF)
    udp[2] = UInt8(dport >> 8); udp[3] = UInt8(dport & 0xFF)
    let len = UInt16(8 + payload.count)
    udp[4] = UInt8(len >> 8); udp[5] = UInt8(len & 0xFF)
    return ip + udp + payload
}

func makeRecord(pid: Int32 = 100, comm: String = "curl", outbound: Bool = true,
                dlt: UInt32 = 12, payload: Data = Data()) -> PktapRecord {
    PktapRecord(pid: pid, comm: comm, epid: 0, ecomm: "", ifname: "en0",
                flags: outbound ? UInt32(GARGOYLE_PTH_FLAG_DIR_OUT) : UInt32(GARGOYLE_PTH_FLAG_DIR_IN),
                innerDLT: dlt, payload: payload)
}

// MARK: - PktapParser

@Suite struct PktapParserTests {
    @Test func parsesAttributionAndPayload() throws {
        let inner = makeIPv4TCP()
        let packet = makePktapPacket(pid: 4242, comm: "curl", dlt: 12, inner: inner)

        let record = try #require(PktapParser.parse(packet))
        #expect(record.pid == 4242)
        #expect(record.comm == "curl")
        #expect(record.ifname == "en0")
        #expect(record.isOutbound)
        #expect(!record.isInbound)
        #expect(record.innerDLT == 12)
        #expect(record.payload == inner)
        #expect(record.processLabel == "curl(4242)")
    }

    @Test func delegateProcessLabel() throws {
        let packet = makePktapPacket(pid: 120, comm: "nsurlsessiond", epid: 843, ecomm: "Safari",
                                     dlt: 12, inner: makeIPv4TCP())
        let record = try #require(PktapParser.parse(packet))
        #expect(record.processLabel == "nsurlsessiond(120) for Safari(843)")
    }

    @Test func rejectsTruncatedHeader() {
        let packet = makePktapPacket(pid: 1, comm: "x", dlt: 12, inner: Data())
        #expect(PktapParser.parse(packet.prefix(10)) == nil)
        #expect(PktapParser.parse(Data([1, 0, 0])) == nil)
    }

    /// A kernel header longer than our struct must still parse, with the
    /// payload located via pth_length.
    @Test func honorsWireHeaderLength() throws {
        let inner = makeIPv4TCP()
        var packet = makePktapPacket(pid: 7, comm: "zsh", dlt: 12, inner: Data())
        let padded = UInt32(MemoryLayout<gargoyle_pktap_header>.size + 16)
        withUnsafeBytes(of: padded) { packet.replaceSubrange(0..<4, with: $0) }
        packet += Data(count: 16) + inner

        let record = try #require(PktapParser.parse(packet))
        #expect(record.comm == "zsh")
        #expect(record.payload == inner)
    }
}

// MARK: - IPParser

@Suite struct IPParserTests {
    @Test func ipv4TCPOverRaw() throws {
        let packet = makeIPv4TCP(src: [192, 168, 1, 5], sport: 53192,
                                 dst: [151, 101, 1, 6], dport: 443)
        let flow = try #require(IPParser.flow(dlt: 12, payload: packet))
        #expect(flow.proto == 6)
        #expect(flow.protoName == "TCP")
        #expect(flow.src == "192.168.1.5")
        #expect(flow.sport == 53192)
        #expect(flow.dst == "151.101.1.6")
        #expect(flow.dport == 443)
    }

    @Test func ipv4UDPOverEthernet() throws {
        var ether = Data(count: 14)
        ether[12] = 0x08; ether[13] = 0x00
        let packet = ether + makeIPv4UDP()

        let flow = try #require(IPParser.flow(dlt: 1, payload: packet))
        #expect(flow.protoName == "UDP")
        #expect(flow.dst == "8.8.8.8")
        #expect(flow.dport == 53)
    }

    @Test func ipv6TCPOverLoopback() throws {
        var af = Data(count: 4)
        withUnsafeBytes(of: UInt32(AF_INET6)) { af.replaceSubrange(0..<4, with: $0) }
        var ip6 = Data(count: 40)
        ip6[0] = 0x60
        ip6[6] = 6                                  // next header: TCP
        ip6[8 + 15] = 1                             // src ::1
        ip6[24 + 15] = 1                            // dst ::1
        var tcp = Data(count: 20)
        tcp.replaceSubrange(0..<4, with: [0x1F, 0x90, 0x1F, 0x91])  // 8080 → 8081

        let flow = try #require(IPParser.flow(dlt: 0, payload: af + ip6 + tcp))
        #expect(flow.proto == 6)
        #expect(flow.src == "::1")
        #expect(flow.dst == "::1")
        #expect(flow.sport == 8080)
        #expect(flow.dport == 8081)
    }

    @Test func rejectsGarbage() {
        #expect(IPParser.flow(dlt: 12, payload: Data([0xFF, 0x00])) == nil)
        #expect(IPParser.flow(dlt: 1, payload: Data(count: 5)) == nil)
        #expect(IPParser.flow(dlt: 0, payload: Data(count: 3)) == nil)
    }
}

// MARK: - FlowTable (spike-era aggregation, still used by gargoyle-spike)

@Suite struct FlowTableTests {
    @Test func aggregatesAndReportsNewFlowsOnce() throws {
        let table = FlowTable()
        let tuple = FlowTuple(proto: 6, src: "10.0.0.5", sport: 50000, dst: "1.2.3.4", dport: 443)

        let first = table.record(record: makeRecord(outbound: true), tuple: tuple, originalLength: 100)
        #expect(first != nil, "first packet of a flow must be reported as new")
        let second = table.record(record: makeRecord(outbound: true), tuple: tuple, originalLength: 50)
        #expect(second == nil, "subsequent packets must not re-report the flow")
        table.record(record: makeRecord(outbound: false), tuple: tuple, originalLength: 500)

        #expect(table.flows.count == 1)
        let key = try #require(first)
        let stats = try #require(table.flows[key])
        #expect(stats.packets == 3)
        #expect(stats.bytesOut == 150)
        #expect(stats.bytesIn == 500)
        #expect(table.packetsSeen == 3)
    }

    @Test func humanBytes() {
        #expect(FlowTable.humanBytes(512) == "512B")
        #expect(FlowTable.humanBytes(2048) == "2.0KB")
        #expect(FlowTable.humanBytes(5 * 1024 * 1024) == "5.0MB")
    }
}
