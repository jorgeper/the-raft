import Foundation
import CPcap
@testable import SpikeCore

// Minimal self-checking test harness — the CLT toolchain has no XCTest or
// Swift Testing. Exits 1 if any expectation fails.

var failures = 0

func expect(_ condition: Bool, _ message: String,
            file: String = #fileID, line: Int = #line) {
    if !condition {
        failures += 1
        print("FAIL  \(message)  (\(file):\(line))")
    }
}

func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String,
                               file: String = #fileID, line: Int = #line) {
    if actual != expected {
        failures += 1
        print("FAIL  \(message): expected \(expected), got \(actual)  (\(file):\(line))")
    }
}

func test(_ name: String, _ body: () -> Void) {
    let before = failures
    body()
    print(before == failures ? "ok    \(name)" : "FAIL  \(name)")
}

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

/// Minimal IPv4+TCP packet: 10.0.0.5:54321 → 93.184.216.34:443.
func makeIPv4TCP() -> Data {
    var ip = Data(count: 20)
    ip[0] = 0x45                               // v4, IHL 5
    ip[9] = 6                                  // TCP
    ip.replaceSubrange(12..<16, with: [10, 0, 0, 5])
    ip.replaceSubrange(16..<20, with: [93, 184, 216, 34])
    var tcp = Data(count: 20)
    tcp.replaceSubrange(0..<4, with: [0xD4, 0x31, 0x01, 0xBB])  // 54321 → 443
    return ip + tcp
}

func makeRecord(outbound: Bool) -> PktapRecord {
    PktapRecord(pid: 100, comm: "curl", epid: 0, ecomm: "", ifname: "en0",
                flags: outbound ? UInt32(GARGOYLE_PTH_FLAG_DIR_OUT) : UInt32(GARGOYLE_PTH_FLAG_DIR_IN),
                innerDLT: 12, payload: Data())
}

// MARK: - PktapParser

test("parses attribution and payload") {
    let inner = makeIPv4TCP()
    let packet = makePktapPacket(pid: 4242, comm: "curl", dlt: 12, inner: inner)

    guard let record = PktapParser.parse(packet) else {
        return expect(false, "parse returned nil")
    }
    expectEqual(record.pid, 4242, "pid")
    expectEqual(record.comm, "curl", "comm")
    expectEqual(record.ifname, "en0", "ifname")
    expect(record.isOutbound, "outbound flag")
    expect(!record.isInbound, "inbound flag clear")
    expectEqual(record.innerDLT, 12, "inner DLT")
    expectEqual(record.payload, inner, "payload")
    expectEqual(record.processLabel, "curl(4242)", "process label")
}

test("delegate process label") {
    let packet = makePktapPacket(pid: 120, comm: "nsurlsessiond", epid: 843, ecomm: "Safari",
                                 dlt: 12, inner: makeIPv4TCP())
    guard let record = PktapParser.parse(packet) else {
        return expect(false, "parse returned nil")
    }
    expectEqual(record.processLabel, "nsurlsessiond(120) for Safari(843)", "delegate label")
}

test("rejects truncated header") {
    let packet = makePktapPacket(pid: 1, comm: "x", dlt: 12, inner: Data())
    expect(PktapParser.parse(packet.prefix(10)) == nil, "10-byte prefix rejected")
    expect(PktapParser.parse(Data([1, 0, 0])) == nil, "3-byte buffer rejected")
}

test("honors wire header length longer than struct") {
    // A kernel header longer than our struct must still parse, with the
    // payload located via pth_length.
    let inner = makeIPv4TCP()
    var packet = makePktapPacket(pid: 7, comm: "zsh", dlt: 12, inner: Data())
    let padded = UInt32(MemoryLayout<gargoyle_pktap_header>.size + 16)
    withUnsafeBytes(of: padded) { packet.replaceSubrange(0..<4, with: $0) }
    packet += Data(count: 16) + inner

    guard let record = PktapParser.parse(packet) else {
        return expect(false, "parse returned nil")
    }
    expectEqual(record.comm, "zsh", "comm")
    expectEqual(record.payload, inner, "payload after padded header")
}

// MARK: - IPParser

test("IPv4 TCP over raw DLT") {
    var ip = Data(count: 20)
    ip[0] = 0x45
    ip[9] = 6
    ip.replaceSubrange(12..<16, with: [192, 168, 1, 5])
    ip.replaceSubrange(16..<20, with: [151, 101, 1, 6])
    var tcp = Data(count: 20)
    tcp.replaceSubrange(0..<4, with: [0xCF, 0xC8, 0x01, 0xBB])  // 53192 → 443

    guard let flow = IPParser.flow(dlt: 12, payload: ip + tcp) else {
        return expect(false, "flow returned nil")
    }
    expectEqual(flow.proto, 6, "proto")
    expectEqual(flow.protoName, "TCP", "proto name")
    expectEqual(flow.src, "192.168.1.5", "src")
    expectEqual(flow.sport, 53192, "sport")
    expectEqual(flow.dst, "151.101.1.6", "dst")
    expectEqual(flow.dport, 443, "dport")
}

test("IPv4 UDP over ethernet") {
    var ether = Data(count: 14)
    ether[12] = 0x08; ether[13] = 0x00
    var ip = Data(count: 20)
    ip[0] = 0x45
    ip[9] = 17
    ip.replaceSubrange(12..<16, with: [10, 0, 0, 5])
    ip.replaceSubrange(16..<20, with: [8, 8, 8, 8])
    var udp = Data(count: 8)
    udp.replaceSubrange(0..<4, with: [0xE9, 0x11, 0x00, 0x35])  // 59665 → 53

    guard let flow = IPParser.flow(dlt: 1, payload: ether + ip + udp) else {
        return expect(false, "flow returned nil")
    }
    expectEqual(flow.protoName, "UDP", "proto name")
    expectEqual(flow.dst, "8.8.8.8", "dst")
    expectEqual(flow.dport, 53, "dport")
}

test("IPv6 TCP over loopback") {
    var af = Data(count: 4)
    withUnsafeBytes(of: UInt32(AF_INET6)) { af.replaceSubrange(0..<4, with: $0) }
    var ip6 = Data(count: 40)
    ip6[0] = 0x60
    ip6[6] = 6                                  // next header: TCP
    ip6[8 + 15] = 1                             // src ::1
    ip6[24 + 15] = 1                            // dst ::1
    var tcp = Data(count: 20)
    tcp.replaceSubrange(0..<4, with: [0x1F, 0x90, 0x1F, 0x91])  // 8080 → 8081

    guard let flow = IPParser.flow(dlt: 0, payload: af + ip6 + tcp) else {
        return expect(false, "flow returned nil")
    }
    expectEqual(flow.proto, 6, "proto")
    expectEqual(flow.src, "::1", "src")
    expectEqual(flow.dst, "::1", "dst")
    expectEqual(flow.sport, 8080, "sport")
    expectEqual(flow.dport, 8081, "dport")
}

test("rejects garbage") {
    expect(IPParser.flow(dlt: 12, payload: Data([0xFF, 0x00])) == nil, "short raw")
    expect(IPParser.flow(dlt: 1, payload: Data(count: 5)) == nil, "short ethernet")
    expect(IPParser.flow(dlt: 0, payload: Data(count: 3)) == nil, "short loopback")
}

// MARK: - FlowTable

test("aggregates and reports new flows once") {
    let table = FlowTable()
    let tuple = FlowTuple(proto: 6, src: "10.0.0.5", sport: 50000, dst: "1.2.3.4", dport: 443)

    let first = table.record(record: makeRecord(outbound: true), tuple: tuple, originalLength: 100)
    expect(first != nil, "first packet reported as new")
    let second = table.record(record: makeRecord(outbound: true), tuple: tuple, originalLength: 50)
    expect(second == nil, "subsequent packet not re-reported")
    table.record(record: makeRecord(outbound: false), tuple: tuple, originalLength: 500)

    expectEqual(table.flows.count, 1, "flow count")
    if let key = first, let stats = table.flows[key] {
        expectEqual(stats.packets, 3, "packets")
        expectEqual(stats.bytesOut, 150, "bytesOut")
        expectEqual(stats.bytesIn, 500, "bytesIn")
    } else {
        expect(false, "stats present for key")
    }
    expectEqual(table.packetsSeen, 3, "packetsSeen")
}

test("human bytes formatting") {
    expectEqual(FlowTable.humanBytes(512), "512B", "bytes")
    expectEqual(FlowTable.humanBytes(2048), "2.0KB", "kilobytes")
    expectEqual(FlowTable.humanBytes(5 * 1024 * 1024), "5.0MB", "megabytes")
}

// MARK: - Result

if failures > 0 {
    print("\n\(failures) failure(s)")
    exit(1)
}
print("\nall tests passed")
