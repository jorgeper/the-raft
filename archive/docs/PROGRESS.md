# Gargoyle — Progress

## Phase 2 — Rules + Firewall (2026-07-12)

### Built

- **RulesEngine** (spec §5): first-match precedence — session/once approvals →
  app+destination (most-specific) → app-wide → global (incl. catch-all) →
  per-app mode → global default. Destination matching for host / `*.suffix` /
  IP / CIDR (v4+v6) / ANY with specificity ranking; port and protocol
  narrowing; scope expiry (`persistent | until-quit | until | once`); rules
  suspended on signer change; system daemons excluded and never firewalled.
  Every decision carries an ordered **why-trace**.
- **RuleStore**: profiles (exactly one active, switchable), rules, per-app
  modes, verdict events with traces, hit counts, JSON profile export/import.
- **Pipeline integration**: every flow is judged on open. `ignore` drops it
  before the audit log; `block` emits a blocked event; firewall + no rule
  raises an approval. **Tap B records `wouldHaveBlocked` rather than claiming
  a block** (spec §2.2) — the packets did leave. Verdicts + traces persist to
  `verdict_events` keyed on the audited flow.
- **FilterVerdictPolicy**: pure, tested **fail-closed** logic (spec §13.1) —
  an unanswerable prompt drops the flow and records a missed prompt, while
  monitored/ignored flows are never dropped for want of a prompt.
- **FilterTap + TapSelector**: Tap A interface and tap selection; reports
  `isAvailable == false` until the signed extension exists, so the app
  degrades to Tap B and shows the monitor-only badge.
- **UI**: always-on-top approval window (allow once/until-quit/always/domain,
  block once/always), inline approvals in the popover, review queue, profile
  switcher, working per-app mode toggles.

### Verified

- **88 tests green**, including 22 rules-precedence tests (the spec §12 TDD
  mandate), profile switching changing live verdicts, would-have-blocked
  labeling, approval → persisted rule → next flow allowed, ignored/system
  flows never audited, and fail-closed policy.
- **Live mock run** exercised every path in the real app:
  `BLOCK (would-have) node → api.github.com` (rule),
  `APPROVAL (retrospective) Slack → wss.slack.com` (firewall, no rule),
  Safari monitored, `nsurlsessiond` silently excluded as a system daemon.

### Deferred verification (needs the user / signed bundle)

- **Actual blocking is not verifiable yet.** `NEFilterDataProvider` requires a
  signed .app bundle with the content-filter entitlement (Apple Developer
  account) plus a System Settings approval. The verdict contract and
  fail-closed policy are built and tested; the live extension target is the
  remaining work. Until then Gargoyle is honest: rules evaluate, blocks are
  labeled *would-have-blocked*, and the UI shows a monitor-only badge.
- Real-traffic run of the rules engine (needs `sudo scripts/install-helper.sh`).

### Decisions / deviations

- The precedence stage "global destination rules" also accepts a catch-all
  (any app → any destination), so a "Paranoid" block-everything profile works.
- Pending approvals outlive their flow: on Tap B the connection has already
  finished, and the item still needs a human verdict in the review queue.
- Bulk actions on the review queue and the precedence *visualization* are
  deferred to Phase 3 (the trace data is already persisted per verdict).

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
