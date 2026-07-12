import Foundation

/// Adjacent watchers (spec §9): cheap, high-signal, no restricted entitlements.
/// File-access and process-execution monitoring stay out of scope — those need
/// the Endpoint Security entitlement Apple grants only to vetted vendors.
public struct WatcherEvent: Identifiable, Sendable, Equatable {
    public enum Kind: String, Sendable {
        case persistenceAdded
        case persistenceChanged
        case quarantinedAppPhonedHome
        case cameraUsed
        case micUsed
    }

    public let id: String
    public let kind: Kind
    public let title: String
    public let detail: String
    public let at: Date

    public init(id: String, kind: Kind, title: String, detail: String, at: Date) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
        self.at = at
    }
}

// MARK: - Persistence monitor

/// Watches launch agents/daemons and login items. New persistence is the
/// classic move of anything shady an installed app does (spec §9).
public struct PersistenceSnapshot: Equatable, Sendable {
    /// path → content fingerprint (size + mtime + first-bytes hash upstream).
    public var items: [String: String]

    public init(items: [String: String] = [:]) {
        self.items = items
    }

    /// Pure diff: what appeared, and what changed underneath us.
    public func diff(against newer: PersistenceSnapshot, at now: Date) -> [WatcherEvent] {
        var events: [WatcherEvent] = []
        for (path, fingerprint) in newer.items {
            guard let existing = items[path] else {
                events.append(WatcherEvent(
                    id: "persist-add-\(path)-\(Int(now.timeIntervalSince1970))",
                    kind: .persistenceAdded,
                    title: "New persistence item",
                    detail: path, at: now))
                continue
            }
            if existing != fingerprint {
                events.append(WatcherEvent(
                    id: "persist-chg-\(path)-\(Int(now.timeIntervalSince1970))",
                    kind: .persistenceChanged,
                    title: "Persistence item changed",
                    detail: path, at: now))
            }
        }
        // Removals are not alerted: uninstalling a launch agent is good news.
        return events
    }
}

public final class PersistenceWatcher: @unchecked Sendable {
    public static let defaultPaths = [
        NSHomeDirectory() + "/Library/LaunchAgents",
        "/Library/LaunchAgents",
        "/Library/LaunchDaemons",
    ]

    private let paths: [String]
    private var snapshot = PersistenceSnapshot()
    private var timer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "gargoyle.persistence")

    public var onEvents: (([WatcherEvent]) -> Void)?

    public init(paths: [String] = PersistenceWatcher.defaultPaths) {
        self.paths = paths
    }

    /// Establishes the baseline without alerting on everything already present.
    public func start(interval: TimeInterval = 30) {
        snapshot = Self.scan(paths: paths)
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in self?.poll() }
        timer.resume()
        self.timer = timer
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    /// Exposed for tests and the initial sweep.
    public func poll(now: Date = Date()) {
        let fresh = Self.scan(paths: paths)
        let events = snapshot.diff(against: fresh, at: now)
        snapshot = fresh
        if !events.isEmpty {
            onEvents?(events)
        }
    }

    static func scan(paths: [String]) -> PersistenceSnapshot {
        var items: [String: String] = [:]
        let fm = FileManager.default
        for directory in paths {
            guard let entries = try? fm.contentsOfDirectory(atPath: directory) else { continue }
            for entry in entries where entry.hasSuffix(".plist") {
                let path = directory + "/" + entry
                guard let attributes = try? fm.attributesOfItem(atPath: path) else { continue }
                let size = (attributes[.size] as? Int) ?? 0
                let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                items[path] = "\(size)-\(Int(modified))"
            }
        }
        return PersistenceSnapshot(items: items)
    }
}

// MARK: - Quarantine watcher

/// Flags the first network activity from a freshly downloaded (quarantine-
/// flagged) app — the "app I just installed from the internet" moment (spec §9).
public struct QuarantineWatcher: Sendable {
    public static let attribute = "com.apple.quarantine"

    private let window: TimeInterval
    private let quarantineDate: @Sendable (String) -> Date?

    public init(window: TimeInterval = 3600,
                quarantineDate: @escaping @Sendable (String) -> Date? = QuarantineWatcher.readQuarantineDate) {
        self.window = window
        self.quarantineDate = quarantineDate
    }

    /// Nil when the binary isn't freshly downloaded, or is outside the window.
    public func check(path: String?, appName: String, destination: String,
                      now: Date = Date()) -> WatcherEvent? {
        guard let path, let downloaded = quarantineDate(path) else { return nil }
        let age = now.timeIntervalSince(downloaded)
        guard age >= 0, age <= window else { return nil }
        return WatcherEvent(
            id: "quarantine-\(path)-\(destination)",
            kind: .quarantinedAppPhonedHome,
            title: "Freshly downloaded app is talking to the network",
            detail: "\(appName) → \(destination) (downloaded \(Int(age / 60))m ago)",
            at: now)
    }

    /// The quarantine xattr's second field is a hex epoch timestamp:
    /// `0081;5f3a1b2c;Safari;UUID`.
    public static func parseQuarantineValue(_ value: String) -> Date? {
        let fields = value.split(separator: ";")
        guard fields.count >= 2, let seconds = UInt32(fields[1], radix: 16) else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(seconds))
    }

    public static let readQuarantineDate: @Sendable (String) -> Date? = { path in
        let length = getxattr(path, attribute, nil, 0, 0, 0)
        guard length > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: length)
        guard getxattr(path, attribute, &buffer, length, 0, 0) == length else { return nil }
        let value = String(cString: buffer + [0])
        return parseQuarantineValue(value)
    }
}

// MARK: - Camera / microphone usage log

/// Audit complement to macOS's live indicator dots: which app used the camera
/// or mic, and when (spec §9). Reads the unified log — no entitlement needed.
public final class AVUsageWatcher: @unchecked Sendable {
    public var onEvents: (([WatcherEvent]) -> Void)?
    private var process: Process?

    public init() {}

    /// Parses one `log stream` line into an event, if it reports AV capture.
    /// Kept pure so the matching logic is testable without spawning `log`.
    public static func parse(line: String, now: Date = Date()) -> WatcherEvent? {
        let lower = line.lowercased()
        let isCamera = lower.contains("camera")
        let isMic = lower.contains("microphone") || lower.contains("audio input")
        guard isCamera || isMic else { return nil }
        // Only "started"/"active" transitions are interesting; ignore stops.
        guard lower.contains("start") || lower.contains("active") || lower.contains("on") else {
            return nil
        }
        guard let client = extractClient(from: line) else { return nil }
        return WatcherEvent(
            id: "av-\(client)-\(isCamera ? "cam" : "mic")-\(Int(now.timeIntervalSince1970))",
            kind: isCamera ? .cameraUsed : .micUsed,
            title: isCamera ? "Camera used" : "Microphone used",
            detail: client, at: now)
    }

    /// Pulls the responsible client out of a control-center/coreaudio log line.
    static func extractClient(from line: String) -> String? {
        // Common shapes: `client=com.example.app`, `"com.example.app"`,
        // `attribution=com.example.app`.
        for marker in ["client=", "attribution=", "clientName=", "bundleID="] {
            if let range = line.range(of: marker) {
                let rest = line[range.upperBound...]
                let value = rest.prefix { !$0.isWhitespace && $0 != "," && $0 != ")" && $0 != "\"" }
                if !value.isEmpty { return String(value) }
            }
        }
        return nil
    }

    public func start() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/log")
        process.arguments = [
            "stream", "--style", "compact",
            "--predicate",
            #"subsystem == "com.apple.coreaudio" OR subsystem == "com.apple.cmio" OR eventMessage CONTAINS[c] "camera""#,
        ]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            let events = text.split(separator: "\n").compactMap { AVUsageWatcher.parse(line: String($0)) }
            if !events.isEmpty {
                self?.onEvents?(events)
            }
        }
        do {
            try process.run()
            self.process = process
        } catch {
            fputs("[gargoyle] AV watcher unavailable: \(error)\n", stderr)
        }
    }

    public func stop() {
        process?.terminate()
        process = nil
    }
}
