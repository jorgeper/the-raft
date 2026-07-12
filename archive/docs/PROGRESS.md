# Gargoyle — Progress

## Phase 1 — Monitor + Audit (2026-07-11)

### Built

- **CaptureKit** (shared by helper + app): pktap/IP parsers (from Phase 0),
  `TapEvent` JSON-lines wire protocol, `FlowAggregator` (bidirectional flows,
  stat deltas, idle close), passive `DNSCorrelator` (A/AAAA→query-name with
  compression parsing), `PktapCapture`, `TapSocketServer`.
- **gargoyle-helperd**: root capture daemon (launchd), streams TapEvents over
  a uid-restricted unix socket (`/var/run/gargoyle.sock`, 0600); `--stdout`
  debug mode.
- **GargoyleCore**: `FlowTap` protocol with `PcapTap` (auto-reconnect client)
  and `MockTap` (scripted replay); `FlowPipeline` actor (identity resolution,
  active flows, finalization); `AuditStore` (GRDB WAL, hash-chained `flows`,
  per-app/day aggregates, 30-day retention); `AppIdentityResolver` (SecCode
  signing ID/team ID, unsigned fallback); `EgressMeter`; `NotificationCoalescer`.
- **GargoyleApp**: SwiftUI `MenuBarExtra` window popover — 60s egress
  sparkline (Swift Charts), recent flows, top apps, pause, system-apps toggle,
  learning-mode banner + digest; UserNotifications with per app+destination
  coalescing (console fallback unbundled); `GARGOYLE_MOCK_TAP` /
  `GARGOYLE_AUTOEXIT` for rootless verification.
- **scripts/**: `install-helper.sh` (launchd bootstrap), `uninstall-helper.sh`,
  `build-app.sh` (ad-hoc-signed `dist/Gargoyle.app`).

### Verified

- 47 tests green (Swift Testing): hash chain (tamper + deletion detection,
  retention-safe verify), flow-replay harness through the full pipeline,
  DNS parsing (CNAME, compression loops), aggregator lifecycle, socket
  round-trip integration (client+server over temp socket, reconnect),
  identity resolution of a live process, meter/coalescer.
- Mock-mode app run: launched, streamed synthetic flows, exited 0; audit rows
  landed hash-chained (verified via sqlite3 before switching mock mode to an
  in-memory store).
- `dist/Gargoyle.app` builds and signs (ad-hoc).

### Deferred verification (needs the user)

- `sudo scripts/install-helper.sh` (launchd daemon install), then run
  `dist/Gargoyle.app` and confirm real flows appear with app names/hostnames.
- First bundled launch: approve the notification-permission prompt.

### Decisions / deviations

- **FilterTap (Tap A) deferred to Phase 2** — only needed for verdicts, and it
  requires the signed extension bundle Phase 2 builds anyway.
- Helper install is a sudo script + launchd daemon for now; SMAppService
  packaging can replace it when the Xcode project lands in Phase 2.
- Long-lived flows finalize at close/quit only (no periodic checkpointing yet).
- Live sparkline *menu-bar icon* (v0.3 optional) deferred to Phase 3 polish;
  popover sparkline is in.
- Per-app quick mode toggles in the popover await the Phase 2 rules engine
  (top-apps list is read-only in Phase 1).

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

### Live capture validation (user-run, 2026-07-11) — PASSED

`sudo .build/debug/gargoyle-spike capture --duration 15` on the primary
machine: per-process attribution confirmed on real traffic (node, Claude
Helper, netbiosd, mDNSResponder — all with pids), correct in/out direction,
TCP and UDP, IPv4. **Phase 0 exit criterion met; Tap B is viable.**

Finding: Apple's libpcap reports the pktap datalink as **149** (DLT_USER2,
Apple's original private assignment), not the official 258. Constants and the
datalink check now accept both. Parsing was unaffected (it keys off the wire
header, not the DLT constant).

### Environment notes / deviations

- Machine has **Command Line Tools only, no Xcode**: neither XCTest nor Swift
  Testing modules are available, so tests live in a minimal self-checking
  executable (`spike-tests`) instead of a `testTarget`. **Phase 1 requires
  full Xcode** (app bundle, SwiftUI app target, system-extension target,
  entitlements, signing) — install before starting Phase 1.
- `pcap_set_want_pktap` is resolved via `dlsym` (Apple-private libpcap API);
  a missing symbol degrades to a warning instead of a link failure.

### Next

- Install full Xcode (required for Phase 1's app bundle and extension targets).
- Phase 1: FlowTap protocol, PcapTap productionization (privileged helper
  instead of sudo-run CLI), GRDB audit store with hash chain, menu-bar app.
