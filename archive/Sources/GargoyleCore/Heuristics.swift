import Foundation

/// Destination categories (spec §8). Drive the constellation's orbital rings,
/// alert coalescing, and the classification line in approval prompts.
public enum DestinationCategory: String, Codable, CaseIterable, Sendable {
    case cdn
    case updates          // OS / app updates
    case telemetry        // analytics, crash reporting
    case ads
    case cloud            // cloud infrastructure / hosting
    case devTooling
    case messaging
    case unknown

    /// Ring index for the constellation: known-and-benign inward, unknown
    /// outermost (spec §7.2 — unknown drawn outermost and hottest-colored).
    public var ring: Int {
        switch self {
        case .cdn: return 0
        case .updates: return 1
        case .cloud: return 2
        case .devTooling: return 2
        case .messaging: return 2
        case .telemetry: return 3
        case .ads: return 3
        case .unknown: return 4
        }
    }

    public var label: String {
        switch self {
        case .cdn: return "CDN"
        case .updates: return "Updates"
        case .telemetry: return "Telemetry"
        case .ads: return "Ads"
        case .cloud: return "Cloud"
        case .devTooling: return "Dev tooling"
        case .messaging: return "Messaging"
        case .unknown: return "Unknown"
        }
    }
}

public struct Classification: Equatable, Sendable {
    public let service: String
    public let category: DestinationCategory

    public static let unknown = Classification(service: "Unknown", category: .unknown)
}

/// Local, deterministic classification (spec §8, §13.6 — no LLM). Bundled
/// static snapshot; refresh is manual and user-triggered, so Gargoyle performs
/// **zero automatic egress** (§10). Lookups never touch the network.
public struct HeuristicsDB: Sendable {
    public struct Entry: Codable, Sendable {
        public var suffix: String        // matches the host or any subdomain
        public var service: String
        public var category: DestinationCategory

        public init(suffix: String, service: String, category: DestinationCategory) {
            self.suffix = suffix
            self.service = service
            self.category = category
        }
    }

    public struct NetEntry: Codable, Sendable {
        public var cidr: String
        public var service: String
        public var category: DestinationCategory

        public init(cidr: String, service: String, category: DestinationCategory) {
            self.cidr = cidr
            self.service = service
            self.category = category
        }
    }

    private let entries: [Entry]
    private let networks: [NetEntry]
    /// Cached per destination, as the spec requires — classification runs on
    /// every flow open.
    private let cache = Cache()

    public init(entries: [Entry] = HeuristicsDB.bundledDomains,
                networks: [NetEntry] = HeuristicsDB.bundledNetworks) {
        self.entries = entries
        self.networks = networks
    }

    /// Hostname wins over IP: a CDN's address block is far less informative
    /// than the name that resolved to it. Longest matching suffix wins.
    public func classify(host: String?, ip: String?) -> Classification {
        let key = "\(host ?? "-")|\(ip ?? "-")"
        if let hit = cache.value(for: key) { return hit }

        var result = Classification.unknown
        if let host = host?.lowercased(), !host.isEmpty {
            var best: Entry?
            for entry in entries {
                let suffix = entry.suffix.lowercased()
                guard host == suffix || host.hasSuffix("." + suffix) else { continue }
                if best == nil || suffix.count > best!.suffix.count {
                    best = entry
                }
            }
            if let best {
                result = Classification(service: best.service, category: best.category)
            }
        }
        if result == .unknown, let ip, !ip.isEmpty {
            for network in networks where CIDR(network.cidr)?.contains(ip) == true {
                result = Classification(service: network.service, category: network.category)
                break
            }
        }
        cache.set(result, for: key)
        return result
    }

    /// Replaces the table from a user-supplied snapshot (manual refresh only —
    /// Gargoyle never fetches this itself, spec §13.4).
    public static func load(from url: URL) throws -> HeuristicsDB {
        struct Snapshot: Codable {
            var domains: [Entry]
            var networks: [NetEntry]
        }
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
        return HeuristicsDB(entries: snapshot.domains, networks: snapshot.networks)
    }

    private final class Cache: @unchecked Sendable {
        private var storage: [String: Classification] = [:]
        private let lock = NSLock()

        func value(for key: String) -> Classification? {
            lock.lock(); defer { lock.unlock() }
            return storage[key]
        }

        func set(_ value: Classification, for key: String) {
            lock.lock(); defer { lock.unlock() }
            if storage.count > 8192 { storage.removeAll(keepingCapacity: true) }
            storage[key] = value
        }
    }
}

// MARK: - Bundled snapshot

extension HeuristicsDB {
    /// Curated static snapshot. Deliberately small and legible rather than
    /// exhaustive: everything unmatched shows up as Unknown in the outer ring
    /// and the review queue, which is the behavior the spec wants (§8).
    public static let bundledDomains: [Entry] = [
        // CDNs
        Entry(suffix: "akamai.net", service: "Akamai", category: .cdn),
        Entry(suffix: "akamaiedge.net", service: "Akamai", category: .cdn),
        Entry(suffix: "cloudfront.net", service: "CloudFront", category: .cdn),
        Entry(suffix: "fastly.net", service: "Fastly", category: .cdn),
        Entry(suffix: "fbcdn.net", service: "Meta CDN", category: .cdn),
        Entry(suffix: "cloudflare.com", service: "Cloudflare", category: .cdn),
        Entry(suffix: "cdn.cloudflare.net", service: "Cloudflare", category: .cdn),
        Entry(suffix: "jsdelivr.net", service: "jsDelivr", category: .cdn),
        Entry(suffix: "gstatic.com", service: "Google Static", category: .cdn),
        Entry(suffix: "sstatic.net", service: "Stack Exchange CDN", category: .cdn),

        // OS / app updates
        Entry(suffix: "swcdn.apple.com", service: "Apple Software Update", category: .updates),
        Entry(suffix: "gs.apple.com", service: "Apple Device Services", category: .updates),
        Entry(suffix: "mesu.apple.com", service: "Apple Software Update", category: .updates),
        Entry(suffix: "sparkle-project.org", service: "Sparkle Updater", category: .updates),
        Entry(suffix: "brew.sh", service: "Homebrew", category: .updates),

        // Telemetry / analytics / crash reporting
        Entry(suffix: "google-analytics.com", service: "Google Analytics", category: .telemetry),
        Entry(suffix: "analytics.google.com", service: "Google Analytics", category: .telemetry),
        Entry(suffix: "sentry.io", service: "Sentry", category: .telemetry),
        Entry(suffix: "crashlytics.com", service: "Crashlytics", category: .telemetry),
        Entry(suffix: "segment.io", service: "Segment", category: .telemetry),
        Entry(suffix: "mixpanel.com", service: "Mixpanel", category: .telemetry),
        Entry(suffix: "amplitude.com", service: "Amplitude", category: .telemetry),
        Entry(suffix: "datadoghq.com", service: "Datadog", category: .telemetry),
        Entry(suffix: "bugsnag.com", service: "Bugsnag", category: .telemetry),
        Entry(suffix: "posthog.com", service: "PostHog", category: .telemetry),
        Entry(suffix: "metrics.apple.com", service: "Apple Analytics", category: .telemetry),

        // Ads
        Entry(suffix: "doubleclick.net", service: "Google Ads", category: .ads),
        Entry(suffix: "googlesyndication.com", service: "Google AdSense", category: .ads),
        Entry(suffix: "googleadservices.com", service: "Google Ads", category: .ads),
        Entry(suffix: "adnxs.com", service: "Xandr", category: .ads),
        Entry(suffix: "criteo.com", service: "Criteo", category: .ads),
        Entry(suffix: "scorecardresearch.com", service: "Comscore", category: .ads),

        // Cloud infrastructure
        Entry(suffix: "amazonaws.com", service: "AWS", category: .cloud),
        Entry(suffix: "azure.com", service: "Azure", category: .cloud),
        Entry(suffix: "windows.net", service: "Azure", category: .cloud),
        Entry(suffix: "googleapis.com", service: "Google APIs", category: .cloud),
        Entry(suffix: "digitalocean.com", service: "DigitalOcean", category: .cloud),
        Entry(suffix: "herokuapp.com", service: "Heroku", category: .cloud),
        Entry(suffix: "icloud.com", service: "iCloud", category: .cloud),

        // Dev tooling
        Entry(suffix: "github.com", service: "GitHub", category: .devTooling),
        Entry(suffix: "githubusercontent.com", service: "GitHub", category: .devTooling),
        Entry(suffix: "gitlab.com", service: "GitLab", category: .devTooling),
        Entry(suffix: "npmjs.org", service: "npm", category: .devTooling),
        Entry(suffix: "pypi.org", service: "PyPI", category: .devTooling),
        Entry(suffix: "crates.io", service: "crates.io", category: .devTooling),
        Entry(suffix: "docker.io", service: "Docker Hub", category: .devTooling),
        Entry(suffix: "anthropic.com", service: "Anthropic", category: .devTooling),

        // Messaging / collaboration
        Entry(suffix: "slack.com", service: "Slack", category: .messaging),
        Entry(suffix: "zoom.us", service: "Zoom", category: .messaging),
        Entry(suffix: "discord.com", service: "Discord", category: .messaging),
        Entry(suffix: "whatsapp.net", service: "WhatsApp", category: .messaging),
    ]

    /// Address blocks, used only when no hostname was correlated.
    public static let bundledNetworks: [NetEntry] = [
        NetEntry(cidr: "17.0.0.0/8", service: "Apple", category: .cloud),
        NetEntry(cidr: "104.16.0.0/12", service: "Cloudflare", category: .cdn),
        NetEntry(cidr: "151.101.0.0/16", service: "Fastly", category: .cdn),
        NetEntry(cidr: "140.82.112.0/20", service: "GitHub", category: .devTooling),
        NetEntry(cidr: "13.32.0.0/12", service: "CloudFront", category: .cdn),
        NetEntry(cidr: "142.250.0.0/15", service: "Google", category: .cloud),
    ]
}
