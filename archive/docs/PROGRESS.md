# Gargoyle — Progress

## Phase 0 — Spike (2026-07-11)

### Built

- SwiftPM package with four targets:
  - `CPcap` — system-library wrapper for Apple's libpcap plus a hand-declared
    `gargoyle_pktap_header` (mirrors xnu `bsd/net/pktap.h`; the header is not in
    the public SDK). Parsers honor the wire `pth_length` rather than assuming
    our struct size matches the running kernel.
  - `SpikeCore` — `PktapParser` (pid/comm/epid/ecomm/ifname/direction/inner DLT),
    `IPParser` (IPv4/IPv6, TCP/UDP over ethernet/loopback/raw), `FlowTable`
    (flow aggregation, live new-flow reporting, per-process summary).
  - `gargoyle-spike` — `capture [--duration N]` (pktap via
    `pcap_create("pktap")` + dlsym'd private `pcap_set_want_pktap`) and `probe`
    (Tap A feasibility report per spec §3).
  - `spike-tests` — self-checking test executable (10 tests, all passing).

### Verified

- `swift build` clean; `swift run spike-tests` → all tests passed.
- `gargoyle-spike probe` on this machine reports:
  - **Not MDM-enrolled**, user is admin, SIP enabled.
  - Two network system extensions (Proton VPN) already active → network
    extensions demonstrably load here.
  - **Conclusion: Tap A (NEFilterDataProvider, full firewall mode) looks
    attainable on this machine.** Definitive test still requires the Phase 1
    signed bundle calling `OSSystemExtensionRequest`.
- Non-root capture fails gracefully with a sudo hint (pktap interface creation
  needs root).

### Deferred verification (needs the user)

- **Live capture run:** `sudo .build/debug/gargoyle-spike capture --duration 15`
  — confirm real flows print with correct process attribution and that the
  datalink reports DLT_PKTAP (258). Cannot be run non-interactively (sudo
  password).

### Environment notes / deviations

- Machine has **Command Line Tools only, no Xcode**: neither XCTest nor Swift
  Testing modules are available, so tests live in a minimal self-checking
  executable (`spike-tests`) instead of a `testTarget`. **Phase 1 requires
  full Xcode** (app bundle, SwiftUI app target, system-extension target,
  entitlements, signing) — install before starting Phase 1.
- `pcap_set_want_pktap` is resolved via `dlsym` (Apple-private libpcap API);
  a missing symbol degrades to a warning instead of a link failure.

### Next

- User runs the sudo capture to validate attribution (the Phase 0 exit
  criterion, spec §11).
- Phase 1: FlowTap protocol, PcapTap productionization (privileged helper
  instead of sudo-run CLI), GRDB audit store with hash chain, menu-bar app.
