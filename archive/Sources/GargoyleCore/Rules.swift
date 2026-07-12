import Foundation

/// Apps are keyed on code-signing identity (spec §4); unsigned binaries fall
/// back to path. A signer change means the key changes, which suspends the old
/// rules and forces a re-prompt.
public struct AppKey: Hashable, Codable, Sendable {
    public var signingID: String?
    public var teamID: String?
    public var path: String?

    public init(signingID: String?, teamID: String?, path: String?) {
        self.signingID = signingID
        self.teamID = teamID
        self.path = path
    }

    public var isUnsigned: Bool { signingID == nil }
}

public enum AppSelector: Hashable, Codable, Sendable {
    case anyApp
    case app(AppKey)

    func matches(_ key: AppKey) -> Bool {
        switch self {
        case .anyApp: return true
        case .app(let selector): return selector == key
        }
    }
}

public enum Destination: Hashable, Codable, Sendable {
    case any
    case host(String)          // exact hostname
    case suffix(String)        // *.example.com — subdomains and the apex
    case ip(String)
    case cidr(String)

    public func matches(host: String?, ip: String) -> Bool {
        switch self {
        case .any:
            return true
        case .host(let want):
            guard let host else { return false }
            return host.compare(want, options: .caseInsensitive) == .orderedSame
        case .suffix(let want):
            guard let host else { return false }
            let h = host.lowercased()
            let w = want.lowercased()
            return h == w || h.hasSuffix("." + w)
        case .ip(let want):
            return ip == want
        case .cidr(let want):
            return CIDR(want)?.contains(ip) ?? false
        }
    }

    /// Higher wins when several app rules match (spec §5 "most-specific
    /// destination"). Bands keep kinds apart; length/prefix refines within a kind.
    public var specificity: Int {
        switch self {
        case .host: return 1000
        case .ip: return 900
        case .suffix(let s): return 500 + s.count
        case .cidr(let c): return 100 + (CIDR(c)?.prefixLength ?? 0)
        case .any: return 0
        }
    }

    public var displayString: String {
        switch self {
        case .any: return "any destination"
        case .host(let h): return h
        case .suffix(let s): return "*.\(s)"
        case .ip(let i): return i
        case .cidr(let c): return c
        }
    }
}

/// IPv4/IPv6 prefix membership test.
struct CIDR {
    let bytes: [UInt8]
    let prefixLength: Int
    private let isV6: Bool

    init?(_ text: String) {
        let parts = text.split(separator: "/")
        guard parts.count == 2, let length = Int(parts[1]) else { return nil }
        guard let (bytes, v6) = CIDR.parseAddress(String(parts[0])) else { return nil }
        guard length >= 0, length <= (v6 ? 128 : 32) else { return nil }
        self.bytes = bytes
        self.prefixLength = length
        self.isV6 = v6
    }

    func contains(_ address: String) -> Bool {
        guard let (other, v6) = CIDR.parseAddress(address), v6 == isV6 else { return false }
        var remaining = prefixLength
        for index in 0..<bytes.count {
            if remaining >= 8 {
                if bytes[index] != other[index] { return false }
                remaining -= 8
            } else if remaining > 0 {
                let mask = UInt8(0xFF << (8 - remaining))
                return (bytes[index] & mask) == (other[index] & mask)
            } else {
                return true
            }
        }
        return true
    }

    private static func parseAddress(_ text: String) -> ([UInt8], Bool)? {
        var v4 = in_addr()
        if inet_pton(AF_INET, text, &v4) == 1 {
            return (withUnsafeBytes(of: v4.s_addr) { Array($0) }, false)
        }
        var v6 = in6_addr()
        if inet_pton(AF_INET6, text, &v6) == 1 {
            return (withUnsafeBytes(of: v6) { Array($0) }, true)
        }
        return nil
    }
}

public enum PortSelector: Hashable, Codable, Sendable {
    case any
    case port(UInt16)

    func matches(_ port: UInt16) -> Bool {
        switch self {
        case .any: return true
        case .port(let want): return want == port
        }
    }
}

public enum ProtoSelector: Hashable, Codable, Sendable {
    case any
    case proto(UInt8)

    func matches(_ proto: UInt8) -> Bool {
        switch self {
        case .any: return true
        case .proto(let want): return want == proto
        }
    }
}

public enum RuleAction: String, Codable, Sendable {
    case allow
    case block
    case alert
}

public enum RuleScope: Hashable, Codable, Sendable {
    case persistent
    case untilQuit
    case until(Date)
    case once

    var isSessionScoped: Bool {
        switch self {
        case .untilQuit, .once: return true
        case .persistent, .until: return false
        }
    }

    func isActive(at now: Date) -> Bool {
        if case .until(let deadline) = self { return now < deadline }
        return true
    }
}

public struct Rule: Identifiable, Hashable, Codable, Sendable {
    public var id: Int64
    public var profileID: Int64
    public var app: AppSelector
    public var destination: Destination
    public var port: PortSelector
    public var proto: ProtoSelector
    public var action: RuleAction
    public var scope: RuleScope
    public var notes: String?

    public init(id: Int64, profileID: Int64, app: AppSelector, destination: Destination,
                port: PortSelector = .any, proto: ProtoSelector = .any,
                action: RuleAction, scope: RuleScope = .persistent, notes: String? = nil) {
        self.id = id
        self.profileID = profileID
        self.app = app
        self.destination = destination
        self.port = port
        self.proto = proto
        self.action = action
        self.scope = scope
        self.notes = notes
    }

    func matches(_ context: FlowContext, at now: Date) -> Bool {
        scope.isActive(at: now)
            && app.matches(context.appKey)
            && destination.matches(host: context.host, ip: context.ip)
            && port.matches(context.port)
            && proto.matches(context.proto)
    }

    public var summary: String {
        let appText: String
        switch app {
        case .anyApp: appText = "any app"
        case .app(let key): appText = key.signingID ?? key.path ?? "unknown app"
        }
        return "\(action.rawValue) \(appText) → \(destination.displayString)"
    }
}

/// Per-app enforcement mode (spec §4). Global default is monitor (§13.2).
public enum AppMode: String, Codable, Sendable {
    case monitor
    case firewall
    case ignore
}

/// What the pipeline should do with a flow.
public enum FlowAction: String, Sendable, Equatable {
    case allow    // explicit rule allow
    case alert    // monitor mode: allow + log + alert
    case block    // firewall: drop (Tap A) / would-have-blocked (Tap B)
    case prompt   // firewall, no matching rule: hold for approval
    case ignore   // not monitored at all
}

/// Which precedence stage produced the decision (spec §5).
public enum DecisionSource: String, Sendable, Equatable {
    case sessionApproval
    case appDestinationRule
    case appWideRule
    case globalDestinationRule
    case appModeDefault
    case globalDefault
    case systemExcluded
}

public struct Decision: Sendable, Equatable {
    public var action: FlowAction
    public var source: DecisionSource
    public var matchedRuleID: Int64?
    /// Ordered record of the stages considered — the "why?" trace.
    public var trace: [String]

    public var explanation: String {
        "\(action.rawValue) (\(source.rawValue))" + (matchedRuleID.map { " via rule \($0)" } ?? "")
    }
}

/// The flow being judged.
public struct FlowContext: Sendable {
    public var appKey: AppKey
    public var appName: String
    public var isSystem: Bool
    public var host: String?
    public var ip: String
    public var port: UInt16
    public var proto: UInt8

    public init(appKey: AppKey, appName: String, isSystem: Bool,
                host: String?, ip: String, port: UInt16, proto: UInt8) {
        self.appKey = appKey
        self.appName = appName
        self.isSystem = isSystem
        self.host = host
        self.ip = ip
        self.port = port
        self.proto = proto
    }

    public var destinationLabel: String { "\(host ?? ip):\(port)" }
}

/// A one-time or until-quit approval granted from a prompt. Held in memory
/// only: session state dies with the app, by construction.
struct SessionApproval {
    let app: AppKey
    let destination: Destination
    let action: RuleAction
    let scope: RuleScope
    var consumed = false
}

/// First-match precedence engine (spec §5). Pure and synchronous: the pipeline
/// and the tests drive it identically.
public struct RulesEngine: Sendable {
    private var rules: [Rule] = []
    private var modes: [AppKey: AppMode] = [:]
    private var sessionApprovals: [SessionApproval] = []
    public private(set) var hitCounts: [Int64: Int] = [:]

    /// Spec §13.3: system daemons excluded by default; opt-in re-includes them
    /// under the System bucket, never in Firewall mode.
    public var includeSystemApps = false
    public var globalDefault: AppMode = .monitor

    public init() {}

    // MARK: - State

    public mutating func replaceRules(_ rules: [Rule]) {
        self.rules = rules
    }

    public mutating func setMode(_ app: AppKey, _ mode: AppMode) {
        modes[app] = mode
    }

    public func mode(for app: AppKey) -> AppMode {
        modes[app] ?? globalDefault
    }

    public var allModes: [AppKey: AppMode] { modes }

    public mutating func addSessionApproval(app: AppKey, destination: Destination,
                                            action: RuleAction, scope: RuleScope) {
        sessionApprovals.append(SessionApproval(app: app, destination: destination,
                                                action: action, scope: scope))
    }

    public mutating func clearSessionApprovals() {
        sessionApprovals.removeAll()
    }

    // MARK: - Evaluation

    public mutating func evaluate(_ context: FlowContext, now: Date = Date()) -> Decision {
        var trace: [String] = []

        // System bucket: excluded entirely unless opted in, and never firewalled.
        if context.isSystem && !includeSystemApps {
            trace.append("system daemon, excluded by default")
            return Decision(action: .ignore, source: .systemExcluded,
                            matchedRuleID: nil, trace: trace)
        }

        // 1. Session / one-time approvals.
        if let index = sessionApprovals.firstIndex(where: { approval in
            !approval.consumed
                && approval.app == context.appKey
                && approval.destination.matches(host: context.host, ip: context.ip)
                && approval.scope.isActive(at: now)
        }) {
            let approval = sessionApprovals[index]
            if approval.scope == .once {
                sessionApprovals[index].consumed = true
            }
            trace.append("matched session approval (\(approval.action.rawValue), \(approval.scope.label)) for \(approval.destination.displayString)")
            return Decision(action: approval.action.flowAction, source: .sessionApproval,
                            matchedRuleID: nil, trace: trace)
        }
        trace.append("no session approval")

        let candidates = rules.filter { $0.matches(context, at: now) }

        // 2. App + destination rules, most specific destination first.
        let appDestination = candidates
            .filter { $0.app != .anyApp && $0.destination != .any }
            .max { $0.destination.specificity < $1.destination.specificity }
        if let match = appDestination {
            trace.append("matched app+destination rule \(match.id): \(match.summary)")
            hitCounts[match.id, default: 0] += 1
            return Decision(action: match.action.flowAction, source: .appDestinationRule,
                            matchedRuleID: match.id, trace: trace)
        }
        trace.append("no app+destination rule")

        // 3. App-wide rules (destination == any).
        if let match = candidates.first(where: { $0.app != .anyApp && $0.destination == .any }) {
            trace.append("matched app-wide rule \(match.id): \(match.summary)")
            hitCounts[match.id, default: 0] += 1
            return Decision(action: match.action.flowAction, source: .appWideRule,
                            matchedRuleID: match.id, trace: trace)
        }
        trace.append("no app-wide rule")

        // 4. Global destination rules (any app, specific destination).
        let global = candidates
            .filter { $0.app == .anyApp && $0.destination != .any }
            .max { $0.destination.specificity < $1.destination.specificity }
        if let match = global {
            trace.append("matched global destination rule \(match.id): \(match.summary)")
            hitCounts[match.id, default: 0] += 1
            return Decision(action: match.action.flowAction, source: .globalDestinationRule,
                            matchedRuleID: match.id, trace: trace)
        }
        trace.append("no global destination rule")

        // 5. Per-app mode default. A system app that was opted in is monitored,
        //    never firewalled (spec §13.3).
        if let mode = modes[context.appKey] {
            let effective: AppMode = (context.isSystem && mode == .firewall) ? .monitor : mode
            trace.append("per-app mode: \(effective.rawValue)")
            return Decision(action: effective.flowAction, source: .appModeDefault,
                            matchedRuleID: nil, trace: trace)
        }

        // 6. Global default (monitor).
        trace.append("global default: \(globalDefault.rawValue)")
        return Decision(action: globalDefault.flowAction, source: .globalDefault,
                        matchedRuleID: nil, trace: trace)
    }
}

extension RuleAction {
    var flowAction: FlowAction {
        switch self {
        case .allow: return .allow
        case .block: return .block
        case .alert: return .alert
        }
    }
}

extension AppMode {
    var flowAction: FlowAction {
        switch self {
        case .monitor: return .alert
        case .firewall: return .prompt
        case .ignore: return .ignore
        }
    }
}

extension RuleScope {
    var label: String {
        switch self {
        case .persistent: return "always"
        case .untilQuit: return "until quit"
        case .until(let date): return "until \(date)"
        case .once: return "once"
        }
    }
}
