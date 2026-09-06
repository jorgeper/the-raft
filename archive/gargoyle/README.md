# Gargoyle

A macOS menu-bar egress monitor and firewall. Watches every outbound connection
with per-app attribution, keeps a tamper-evident audit log, and evaluates rules
about what each app is allowed to talk to.

Named for the gargoyles of Neal Stephenson's *Snow Crash* — the always-on
observers who record and analyze everything around them.

See [`spec.md`](spec.md) for the full design and
[`docs/PROGRESS.md`](docs/PROGRESS.md) for what is built and what is not.

## Status

Phases 0–3 of the spec are implemented: capture, audit log, rules engine,
approval prompts, constellation visualization, activity heatmaps, and the
persistence/quarantine/camera-mic watchers. 117 tests.

**Gargoyle cannot actually block traffic yet.** Blocking requires an
`NEFilterDataProvider` system extension, which needs a signed app bundle with
the content-filter entitlement (an Apple Developer account plus a System
Settings approval). Until that exists, Gargoyle runs monitor-only: rules are
evaluated and a blocked flow is labeled **"would have blocked"**, and the UI
shows a monitor-only badge. Nothing pretends otherwise.

## Running it

Three options, from least to most commitment.

### 1. The capture spike — nothing is installed

Prints live flows with the owning process. Ctrl-C and it's gone; nothing
persists, nothing is installed.

```sh
swift build
sudo .build/debug/gargoyle-spike capture --duration 15
```

Needs `sudo` because creating the `pktap` capture interface requires root.

```
NEW  23:15:48  out  Safari(843)   TCP  192.168.4.76:62426 → 104.16.11.34:443  en0
NEW  23:15:48  out  node(10427)   TCP  192.168.4.76:62427 → 140.82.113.4:443  en0
```

There is also a probe that reports whether the content-filter system extension
could be activated on this machine:

```sh
.build/debug/gargoyle-spike probe
```

### 2. Mock mode — the full UI, no root, no real traffic

Runs the whole app against synthetic traffic and an in-memory database. Touches
nothing on your system.

```sh
GARGOYLE_MOCK_TAP=1 swift run GargoyleApp
```

A shield icon appears in the menu bar. The popover, constellation, heatmap,
rules, and review queue all work; the demo seeds a few rules so blocked flows
and approval prompts are exercised.

### 3. The real thing — installs a root daemon

Capturing continuously requires a privileged helper, because pktap needs root.

```sh
sudo scripts/install-helper.sh   # builds + installs the capture daemon
scripts/build-app.sh             # assembles dist/Gargoyle.app (ad-hoc signed)
open dist/Gargoyle.app
```

Click the menu-bar shield for the popover; **Open** in its footer shows the main
window (constellation, timeline, rules, review, watchers).

Expect a notification-permission prompt, and possibly a Gatekeeper warning
(the bundle is only ad-hoc signed — right-click → Open).

## What the helper installs, and how to remove it

`install-helper.sh` is a root daemon that runs at boot. It is worth knowing
exactly what it puts on your machine:

| What | Where |
|---|---|
| Capture binary | `/Library/PrivilegedHelperTools/gargoyle-helperd` |
| launchd job (runs it as root at boot) | `/Library/LaunchDaemons/com.gargoyle.helperd.plist` |
| Unix socket, `0600`, your uid only | `/var/run/gargoyle.sock` |
| Log | `/var/log/gargoyle-helperd.log` |

No kernel extension, no system extension, no MDM profile, no login items,
nothing in `PATH`. `pktap` is a read-only capture interface — the helper does
not sit in the network path and cannot alter traffic. The app writes its audit
database to `~/Library/Application Support/Gargoyle/audit.sqlite`.

Gargoyle performs **zero automatic egress**: it never phones home, and the
heuristics table is a bundled static snapshot refreshed only by hand.

To remove everything:

```sh
sudo scripts/uninstall-helper.sh              # daemon, binary, plist, socket
sudo rm -f /var/log/gargoyle-helperd.log      # its log
rm -rf ~/Library/Application\ Support/Gargoyle # the audit database
rm -rf dist/Gargoyle.app                       # the app bundle
```

That is genuinely all of it. There is no installer package and no receipts.

## Development

```sh
swift build          # everything
swift test           # 117 tests
```

Targets:

- `CaptureKit` — pktap/IP parsing, flow aggregation, DNS correlation, tap wire protocol
- `GargoyleCore` — tap clients, flow pipeline, hash-chained audit store, rules engine, heuristics, watchers
- `gargoyle-helperd` — privileged capture daemon
- `GargoyleApp` — SwiftUI menu-bar app
- `gargoyle-spike` — Phase 0 capture CLI and system-extension probe

Verification hooks used during development:

```sh
GARGOYLE_MOCK_TAP=1 GARGOYLE_AUTOEXIT=15 swift run GargoyleApp   # bounded mock run
GARGOYLE_MOCK_TAP=1 GARGOYLE_RENDER=/tmp/out swift run GargoyleApp  # render views to PNG
```

Requires macOS 14+, Xcode 16+ (Swift 5.10+).
