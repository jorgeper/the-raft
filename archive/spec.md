# Gargoyle — macOS Egress Monitor & Firewall

> Named for the gargoyles of Neal Stephenson's *Snow Crash* — the always-on observers who record and analyze everything around them.

**Version:** 0.3 (adds rule profiles and live menu-bar icon)
**Target:** Personal-use macOS app (Apple Silicon, macOS 14+), including deployment on an MDM-managed work Mac

---

## 1. Overview

Gargoyle is a menu-bar macOS application that monitors outbound network activity per-application, maintains a tamper-evident audit log, alerts on egress, and lets the user allow/block traffic through a flexible rules engine — with a visual, explorable UI for understanding what each app is doing on the network.

### Goals

- Observe **every outbound connection** with reliable per-app attribution.
- Per-app enforcement mode: **Monitor** (allow + log + alert) or **Firewall** (block until approved).
- **Slick, simple UI**: menu-bar-first interaction; a per-app "network constellation" visualization; activity timelines.
- **Rules engine** with one-time approvals, per-destination rules, per-app rules, and global defaults.
- **Destination intelligence** via a local, deterministic heuristics DB (no LLM).
- Durable, queryable **audit log**.
- **Degrade gracefully on managed Macs**: a monitor-only mode that avoids system-extension approval.

### Non-Goals

- LLM/AI analysis (cut — heuristics DB covers classification; revisit only if manual triage proves painful).
- TLS payload decryption (MITM) — optional far-future phase.
- Inbound monitoring, fleet management, full EDR. File/process-level monitoring via Endpoint Security is out of scope (see §9).

---

## 2. Architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Gargoyle.app (menu bar UI) │◄─XPC──►│  Tap layer (pluggable)       │
│  SwiftUI + Swift Charts     │        │  A) GargoyleExtension        │
│  - Popover: alerts/toggles  │        │     NEFilterDataProvider     │
│  - Constellation & timeline │        │     (full: monitor + block)  │
│  - Rules management         │        │  B) PcapTap (fallback)       │
│  - SQLite audit store       │        │     libpcap on pktap         │
│  - Heuristics DB lookup     │        │     (monitor-only, no MDM    │
└─────────────────────────────┘        │      approval needed)        │
                                       └──────────────────────────────┘
```

### 2.1 Tap A — NetworkExtension Content Filter (full mode)

- **`NEFilterDataProvider`** in a System Extension: per-flow callbacks before data moves, built-in app attribution (audit token → bundle ID, signing identity), allow/drop/hold verdicts. Required for Firewall mode.
- Requirements: Apple Developer account, `networking.networkextension` (content-filter) entitlement, **admin rights + user approval** of the system extension in System Settings, and on MDM-managed machines possibly **MDM allowance** (see §3).
- **Fail-closed (decided):** if the UI app is unreachable and a Firewall-mode app has no matching rule, the flow is blocked and a "missed prompt" record is persisted.

### 2.2 Tap B — PcapTap (managed-Mac / fallback mode)

- Passive capture on the `pktap` pseudo-interface via libpcap, which carries **process metadata per packet** (pid, process name). Requires root (a small privileged helper launched via `sudo`/SMJobBless-style setup) but **no entitlement, no system extension, no MDM approval**.
- Monitor-only: full firehose, audit, alerts, visualizations — but no blocking and no hold-for-approval. Rules still evaluate and label flows as *would-have-blocked* so the rule set is ready if/when Tap A becomes available.
- The tap layer is a protocol (`FlowTap`); the rest of the app is identical under either tap.

### 2.3 Flow lifecycle & captured data

Unchanged from v0.1: rule lookup on new flow → verdict (or allow+alert in Monitor mode) → byte counts and close events feed the audit record. Captured per flow: timestamp, app identity, hostname (endpoint/SNI/DNS-correlated), IP, port, protocol, direction, bytes up/down, duration, verdict, matched rule. Unencrypted payloads (plain HTTP, DNS, mDNS) captured size-capped (64KB default) with hex/text views. No TLS payload contents.

---

## 3. Deployment on a managed (MDM) work Mac

Gargoyle is designed to be honest about what it can do under corporate management:

| Capability | Needs | Likely on managed Mac |
|---|---|---|
| Tap B monitor-only (pcap/pktap) | Admin/sudo for the helper | Usually fine if you have admin rights |
| Tap A monitor via content filter | Admin + System Settings approval; MDM may need to allow the system extension | Depends on MDM policy |
| Tap A firewall (blocking) | Same as above | Same as above |

- **Startup detection:** on launch, Gargoyle probes whether the system extension can be activated; if activation is denied by policy, it offers Tap B automatically and shows a persistent "monitor-only (managed device)" badge.
- Multiple content filters can coexist on macOS (a corporate Zscaler/Netskope/CrowdStrike filter does not technically preclude Gargoyle), but MDM commonly restricts *which* system extensions may load (allow-listed Team IDs).
- **Policy note surfaced in-app:** users on managed devices should confirm with IT that running a packet-capture/firewall tool complies with the acceptable-use policy. Gargoyle never exfiltrates anything (its own traffic is nil in Tap B mode; heuristics refresh is manual).

---

## 4. App selection & modes

- **Scope selector:** all apps (default) or include-list; exclude-list supported.
- **Per-app mode:** `Monitor` | `Firewall` | `Ignore`. Global default is **Monitor (watch mode)**; the user escalates chosen apps to Firewall.
- **System daemons excluded by default** (Apple platform binaries: `nsurlsessiond`, `trustd`, etc.). Opt-in toggle re-includes them under a collapsible "System" bucket, never Firewall-mode.
- **Learning mode:** first-run (or on-demand per app) Monitor window (1h/24h) that collects a baseline silently, then presents a digest for bulk rule creation.
- App identity keyed on **code-signing identity** (Team ID + signing ID), path fallback for unsigned binaries (visually flagged). Signer change → rules suspended, re-prompt.

---

## 5. Rules engine

Unchanged from v0.1:

- **Rule:** `{app_selector, destination (host | *.suffix | IP | CIDR | ANY), port, protocol, action (ALLOW | BLOCK | ALERT), scope (persistent | until-quit | until | once), notes, hit_count}`.
- **Precedence (first match wins):** one-time/session approvals → app+destination rules (most-specific destination) → app-wide rules → global destination rules → per-app mode default → global default. "Why was this allowed/blocked?" trace on any audit entry.
- **Approval prompt:** app icon + signing identity, destination, first-seen status, heuristics classification. Actions: Allow once / until quit / always / domain-for-app; Block once / always; open inspector.
- **Rule profiles:** rules belong to named, switchable profiles (e.g., "Normal", "Paranoid", "Hotel Wi-Fi"). Exactly one profile is active at a time; switching is a dropdown in the menu bar popover. Approvals and new rules write into the active profile. Profiles are exportable/importable as JSON. Implementation: a `profile_id` column on rules plus a `profiles` table; the extension's in-memory rule cache is rebuilt on switch. (Future hook: auto-switch profile by Wi-Fi SSID.)

---

## 6. Audit log

Unchanged from v0.1: SQLite (WAL) in `~/Library/Application Support/Gargoyle/`; tables `flows`, `payloads`, `rules`, `verdict_events`, `app_identities`; hash-chained flow rows for tamper evidence; retention 30 days detail + indefinite per-app/day aggregates; JSON/CSV export; full filter/query in the firehose.

---

## 7. UI

Design language: dark, minimal, one accent color per verdict state (green allow / amber alert / red block), generous whitespace, everything animated subtly with SwiftUI transitions. No dashboards-for-the-sake-of-dashboards — three focused surfaces:

### 7.1 Menu bar (primary surface)

- **NSStatusItem** whose icon doubles as a live indicator: quiet dot when idle, animated pulse + badge count when alerts are pending, distinct glyph when a Firewall hold is waiting.
- **Live-graph icon mode (optional):** the status item itself renders as a tiny real-time throughput sparkline (last ~60s of total egress, redrawn ~1 Hz into the status item image), so ambient awareness costs zero clicks. Toggle between dot mode and graph mode in settings; alert badge overlays in either mode.
- Click → **SwiftUI popover** (not a window):
  - Header: 60-second **egress sparkline** (total bytes/sec, Swift Charts) so a glance shows "is anything talking right now."
  - **Pending approvals** stack (act inline: allow/block buttons right in the popover).
  - **Recent events** list (last ~10, relative timestamps, app icons).
  - Quick per-app mode toggles for the 5 most active apps.
  - Footer: active **rule profile** dropdown · pause monitoring (auto-resume timer) · open main window · settings.

### 7.2 Constellation view (the "cool visual")

Select an app → full-window radial graph rendered with SwiftUI `Canvas` + `TimelineView`:

- The **app sits at center** (icon). Each **destination is a node** placed on orbital rings by category from the heuristics DB (CDN ring, API ring, telemetry ring, unknown ring — unknown drawn outermost and hottest-colored).
- **Node size** = cumulative bytes; **edge thickness** = recent throughput; a live flow animates a **pulse traveling along the edge** in the transfer direction.
- Node color = verdict state (allowed/alerted/blocked). Hover → tooltip (host, bytes, last seen); click → inspector panel slides in from the right with full metadata, payload viewer, and pre-filled rule buttons ("block this domain for this app").
- Time scrubber at the bottom: drag to replay the constellation over any window from the audit log — blocked nodes flash red as you scrub past their attempts.

### 7.3 Timeline & apps view

- **Activity heatmap** per app: 7×24 grid (day × hour), cell intensity = egress volume; instantly shows "why does this app phone home at 3am."
- Per-app rollup: mode toggle, destination list grouped by heuristics category, total volume, anomaly badges ("first-ever destination," "10× normal volume").
- Rules view and Alerts/Review queue as in v0.1 (bulk actions, precedence visualization).

### 7.4 Notifications

UserNotifications for Monitor-mode alerts, coalesced per app+domain. Firewall prompts use a dedicated always-on-top approval window.

---

## 8. Destination intelligence (heuristics only)

- Bundled lookup tables mapping domains/CIDRs → service + category (CDN, OS/app updates, telemetry/analytics, ads, cloud infra, dev tooling). Sources: curated open lists. Cached per destination; drives constellation rings, alert coalescing, and the classification line in prompts.
- **Bundled static snapshot + manual refresh only** — Gargoyle performs no automatic egress.
- Unknown destinations are simply labeled **Unknown** and surfaced prominently (outer ring, review queue) for the human to judge. A "look up" button opens the domain in the browser for manual research.

---

## 9. Beyond networking (adjacent watchers)

In scope — cheap, high-signal, no restricted entitlements:

- **Persistence monitor (Phase 3):** watch `~/Library/LaunchAgents`, `/Library/LaunchAgents`, `/Library/LaunchDaemons`, and login-item registrations for additions/changes (FSEvents + periodic diff). New persistence = the classic move of anything shady an installed app does. Alerts feed the same review queue.
- **Mic/camera usage log (Phase 3, optional):** subscribe to the unified log for AV-capture events and record which app used camera/mic when — an audit complement to macOS's live indicator dots.
- **Quarantine watcher (Phase 3, optional):** flag first network activity from a freshly downloaded (quarantine-flagged) app within its first hour — exactly the "app I just installed from the internet" moment you care about.

Explicitly out of scope: file-access and process-execution monitoring. Doing that properly requires the **Endpoint Security** framework, whose entitlement Apple grants only to vetted security vendors after review — impractical for a personal tool, and heavyweight on a managed Mac. (For reference, Objective-See's free tools — BlockBlock, OverSight, ReiKey — cover these niches well and can run alongside Gargoyle.)

---

## 10. Security & privacy

- Gargoyle itself performs **zero automatic egress**; its only network activity is the user-triggered heuristics refresh, visible in its own firehose.
- Extension↔app XPC validated by code-signing requirements on both ends; hardened runtime.
- Payload captures may contain sensitive data → restrictive permissions, optional at-rest encryption (Keychain key), per-app opt-out.
- Honest limits: a content filter raises the bar and gives visibility; root-level malware can evade it. On managed Macs in Tap B mode, Gargoyle observes but cannot block.

---

## 11. Phased plan

| Phase | Deliverable |
|---|---|
| **0 — Spike** | PcapTap prototype: pktap capture with process attribution, flows printed to console. Also validates whether the system extension activates on the work machine. |
| **1 — Monitor + Audit** | Tap layer abstraction (PcapTap first, FilterTap where permitted), flow pipeline, SQLite audit + hash chain, menu bar popover with sparkline + recent events, notifications, learning mode. |
| **2 — Rules + Firewall** | Rules engine + precedence trace, approval prompts, per-app modes, hold-and-verdict (Tap A only; "would-have-blocked" labeling on Tap B), review queue. |
| **3 — Visual & watchers** | Constellation view with time scrubber, activity heatmaps, heuristics DB integration, persistence monitor, quarantine watcher, mic/cam log. |
| **4 — Optional future** | Targeted MITM for one suspicious app; anomaly detection on learned baselines. |

## 12. Tech stack

- Swift 5.10+, SwiftUI, Swift Charts, Canvas/TimelineView for the constellation
- NetworkExtension (content filter) + libpcap/pktap behind a `FlowTap` protocol; XPC
- SQLite via GRDB
- Testing: rules-precedence and hash-chain unit tests; flow-replay harness feeding recorded flows through the pipeline

## 13. Resolved decisions

1. Fail-closed for Firewall-mode apps when the extension can't reach the UI app.
2. Global default is Monitor (watch mode); Firewall is opt-in per app.
3. System daemons excluded by default (opt-in toggle, System bucket, never Firewall).
4. Heuristics DB: bundled static + manual refresh only.
5. No geo/ASN enrichment in v1.
6. **No LLM layer** — heuristics DB + human review; unknowns surfaced visually instead of auto-classified.
7. Dual-tap architecture so the app remains useful (monitor-only) on an MDM-managed Mac.
8. **v0.3 additions:** switchable **rule profiles** (JSON export/import) and optional **live sparkline menu-bar icon**. Other candidate small features (panic button, first-contact toast, temporary allows, ⌘K palette, domain notes, weekly digest, per-app totals, network-aware posture) were considered and deferred.
