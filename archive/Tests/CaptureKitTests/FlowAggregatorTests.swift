import Testing
import Foundation
@testable import CaptureKit

private let t0 = Date(timeIntervalSince1970: 1_700_000_000)

private func collect(_ aggregator: FlowAggregator) -> Box {
    let box = Box()
    aggregator.onEvent = { box.events.append($0) }
    return box
}

private final class Box {
    var events: [TapEvent] = []
    func ofKind(_ kind: TapEvent.Kind) -> [TapEvent] { events.filter { $0.kind == kind } }
}

@Suite struct FlowAggregatorTests {
    private let outTuple = FlowTuple(proto: 6, src: "10.0.0.5", sport: 50000,
                                     dst: "1.2.3.4", dport: 443)
    private let inTuple = FlowTuple(proto: 6, src: "1.2.3.4", sport: 443,
                                    dst: "10.0.0.5", dport: 50000)

    @Test func emitsNewOnceAndMergesReplies() {
        let aggregator = FlowAggregator()
        let box = collect(aggregator)

        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 100, at: t0)
        aggregator.ingest(record: makeRecord(outbound: false), tuple: inTuple, length: 500, at: t0.addingTimeInterval(1))
        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 50, at: t0.addingTimeInterval(2))

        let news = box.ofKind(.new)
        #expect(news.count == 1, "reply must merge into the outbound flow, not open a new one")
        #expect(news.first?.dst == "1.2.3.4")
        #expect(news.first?.dport == 443)
        #expect(news.first?.comm == "curl")
    }

    @Test func statEmitsDeltasThenGoesQuiet() throws {
        let aggregator = FlowAggregator()
        let box = collect(aggregator)

        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 100, at: t0)
        aggregator.ingest(record: makeRecord(outbound: false), tuple: inTuple, length: 700, at: t0)
        aggregator.tick(now: t0.addingTimeInterval(2))

        let stat = try #require(box.ofKind(.stat).first)
        #expect(stat.bytesOut == 100)
        #expect(stat.bytesIn == 700)

        // No further traffic: the next tick must not emit another stat.
        aggregator.tick(now: t0.addingTimeInterval(4))
        #expect(box.ofKind(.stat).count == 1)
    }

    @Test func closesIdleFlowsWithTotals() throws {
        let aggregator = FlowAggregator(idleTimeout: 60)
        let box = collect(aggregator)

        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 100, at: t0)
        aggregator.tick(now: t0.addingTimeInterval(2))
        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 40, at: t0.addingTimeInterval(5))
        aggregator.tick(now: t0.addingTimeInterval(70))

        let close = try #require(box.ofKind(.close).first)
        #expect(close.bytesOut == 140, "close carries totals, not deltas")
        let newID = try #require(box.ofKind(.new).first?.id)
        #expect(close.id == newID)

        // Traffic after close opens a distinct flow.
        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 10, at: t0.addingTimeInterval(80))
        #expect(box.ofKind(.new).count == 2)
        #expect(box.ofKind(.new).last?.id != newID)
    }

    @Test func distinctProcessesGetDistinctFlows() {
        let aggregator = FlowAggregator()
        let box = collect(aggregator)

        aggregator.ingest(record: makeRecord(pid: 1, comm: "curl", outbound: true),
                          tuple: outTuple, length: 10, at: t0)
        aggregator.ingest(record: makeRecord(pid: 2, comm: "node", outbound: true),
                          tuple: outTuple, length: 10, at: t0)
        #expect(box.ofKind(.new).count == 2)
    }

    @Test func inboundFirstFlowCanonicalizesReversed() throws {
        let aggregator = FlowAggregator()
        let box = collect(aggregator)

        // First observed packet is the inbound side (e.g. capture started
        // mid-connection): the flow orients toward the remote peer.
        aggregator.ingest(record: makeRecord(outbound: false), tuple: inTuple, length: 300, at: t0)
        let new = try #require(box.ofKind(.new).first)
        #expect(new.dst == "1.2.3.4")
        #expect(new.dport == 443)

        aggregator.tick(now: t0.addingTimeInterval(2))
        let stat = try #require(box.ofKind(.stat).first)
        #expect(stat.bytesIn == 300)
        #expect(stat.bytesOut == 0)
    }

    @Test func closeAllFlushesEverything() {
        let aggregator = FlowAggregator()
        let box = collect(aggregator)
        aggregator.ingest(record: makeRecord(pid: 1, comm: "a", outbound: true), tuple: outTuple, length: 1, at: t0)
        aggregator.ingest(record: makeRecord(pid: 2, comm: "b", outbound: true), tuple: outTuple, length: 2, at: t0)
        aggregator.closeAll(at: t0.addingTimeInterval(1))
        #expect(box.ofKind(.close).count == 2)
    }

    @Test func resolvesHostnamesOnNew() throws {
        let aggregator = FlowAggregator(hostnameResolver: { ip in
            ip == "1.2.3.4" ? "api.example.com" : nil
        })
        let box = collect(aggregator)
        aggregator.ingest(record: makeRecord(outbound: true), tuple: outTuple, length: 1, at: t0)
        #expect(try #require(box.ofKind(.new).first).host == "api.example.com")
    }
}

@Suite struct TapWireTests {
    @Test func roundTripsEvents() throws {
        var event = TapEvent(kind: .new)
        event.ts = 1_700_000_000.5
        event.id = 42
        event.pid = 123
        event.comm = "curl"
        event.proto = 6
        event.src = "10.0.0.5"
        event.sport = 50000
        event.dst = "1.2.3.4"
        event.dport = 443
        event.host = "example.com"
        event.ifname = "en0"

        let line = try TapWire.encodeLine(event)
        #expect(line.last == 0x0A)
        let decoded = try TapWire.decode(line: line.dropLast())
        #expect(decoded == event)
    }
}
