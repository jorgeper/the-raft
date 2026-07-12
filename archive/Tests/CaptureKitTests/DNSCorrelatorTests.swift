import Testing
import Foundation
@testable import CaptureKit

/// DNS wire-format builders.
private func dnsName(_ name: String) -> [UInt8] {
    var out: [UInt8] = []
    for label in name.split(separator: ".") {
        out.append(UInt8(label.utf8.count))
        out.append(contentsOf: Array(label.utf8))
    }
    out.append(0)
    return out
}

/// A response for `query` with the given answers appended in order.
/// Answers reference the question name via a compression pointer to offset 12.
private func dnsResponse(query: String, answers: [(type: UInt16, rdata: [UInt8])],
                         rcode: UInt8 = 0) -> Data {
    var bytes: [UInt8] = []
    bytes += [0x12, 0x34]                          // id
    bytes += [0x81, 0x80 | rcode]                  // QR=1, RD/RA, rcode
    bytes += [0, 1]                                // qdcount
    bytes += [0, UInt8(answers.count)]             // ancount
    bytes += [0, 0, 0, 0]                          // nscount, arcount
    bytes += dnsName(query)
    bytes += [0, 1, 0, 1]                          // qtype A, qclass IN
    for answer in answers {
        bytes += [0xC0, 0x0C]                      // name: pointer to question
        bytes += [UInt8(answer.type >> 8), UInt8(answer.type & 0xFF)]
        bytes += [0, 1]                            // class IN
        bytes += [0, 0, 0, 60]                     // ttl
        bytes += [UInt8(answer.rdata.count >> 8), UInt8(answer.rdata.count & 0xFF)]
        bytes += answer.rdata
    }
    return Data(bytes)
}

@Suite struct DNSCorrelatorTests {
    @Test func mapsARecordToQueryName() {
        let correlator = DNSCorrelator()
        correlator.ingest(datagram: dnsResponse(
            query: "Example.COM",
            answers: [(type: 1, rdata: [93, 184, 216, 34])]))
        #expect(correlator.hostname(for: "93.184.216.34") == "example.com")
        #expect(correlator.hostname(for: "1.1.1.1") == nil)
    }

    /// CNAME chains: all answered addresses map to the original question name.
    @Test func cnameChainMapsToQueryName() {
        let correlator = DNSCorrelator()
        correlator.ingest(datagram: dnsResponse(
            query: "www.github.com",
            answers: [
                (type: 5, rdata: dnsName("github.com")),       // CNAME
                (type: 1, rdata: [140, 82, 113, 4]),            // A for the CNAME target
            ]))
        #expect(correlator.hostname(for: "140.82.113.4") == "www.github.com")
    }

    @Test func mapsAAAARecord() {
        let correlator = DNSCorrelator()
        var rdata = [UInt8](repeating: 0, count: 16)
        rdata[0] = 0x26; rdata[1] = 0x06            // 2606::…
        rdata[15] = 0x44
        correlator.ingest(datagram: dnsResponse(query: "cdn.example.net",
                                                answers: [(type: 28, rdata: rdata)]))
        #expect(correlator.hostname(for: "2606::44") == "cdn.example.net")
    }

    @Test func ignoresQueriesErrorsAndGarbage() {
        let correlator = DNSCorrelator()
        // A query (QR=0) must not populate the cache.
        var query = dnsResponse(query: "example.com", answers: [(type: 1, rdata: [1, 2, 3, 4])])
        query[2] = 0x01                             // clear QR bit
        correlator.ingest(datagram: query)
        #expect(correlator.hostname(for: "1.2.3.4") == nil)

        // NXDOMAIN must not populate the cache.
        correlator.ingest(datagram: dnsResponse(query: "nope.example.com",
                                                answers: [(type: 1, rdata: [5, 6, 7, 8])], rcode: 3))
        #expect(correlator.hostname(for: "5.6.7.8") == nil)

        // Garbage must not crash.
        correlator.ingest(datagram: Data([0xFF, 0x00, 0x01]))
        correlator.ingest(datagram: Data())
    }

    /// Compression loops (pointer to self) must be rejected, not spin.
    @Test func rejectsPointerLoops() {
        var bytes: [UInt8] = []
        bytes += [0x12, 0x34, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]
        bytes += [0xC0, 0x0C]                       // question name: pointer to itself
        bytes += [0, 1, 0, 1]
        #expect(DNSCorrelator.parseResponse(Data(bytes)) == nil)
    }

    @Test func evictsBeyondCapacity() {
        let correlator = DNSCorrelator(capacity: 2)
        correlator.ingest(datagram: dnsResponse(query: "a.com", answers: [(type: 1, rdata: [1, 0, 0, 1])]))
        correlator.ingest(datagram: dnsResponse(query: "b.com", answers: [(type: 1, rdata: [1, 0, 0, 2])]))
        correlator.ingest(datagram: dnsResponse(query: "c.com", answers: [(type: 1, rdata: [1, 0, 0, 3])]))
        #expect(correlator.hostname(for: "1.0.0.1") == nil)     // evicted
        #expect(correlator.hostname(for: "1.0.0.3") == "c.com")
    }
}

@Suite struct UDPPayloadTests {
    @Test func extractsDatagramPayload() throws {
        let dns = dnsResponse(query: "example.com", answers: [(type: 1, rdata: [93, 184, 216, 34])])
        let packet = makeIPv4UDP(src: [8, 8, 8, 8], sport: 53,
                                 dst: [10, 0, 0, 5], dport: 59665, payload: dns)
        let extracted = try #require(IPParser.udpPayload(dlt: 12, payload: packet))
        #expect(extracted == dns)
    }

    @Test func nilForTCP() {
        #expect(IPParser.udpPayload(dlt: 12, payload: makeIPv4TCP()) == nil)
    }
}
