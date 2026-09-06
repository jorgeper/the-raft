import Foundation
import Security

/// Code-signing identity of a running process (spec §4): apps are keyed on
/// signing ID + team ID; unsigned binaries fall back to path and are flagged.
public struct ResolvedIdentity: Sendable, Equatable {
    public var signingID: String?
    public var teamID: String?
    public var path: String?
    public var displayName: String
    public var isSystem: Bool

    public init(signingID: String?, teamID: String?, path: String?,
                displayName: String, isSystem: Bool) {
        self.signingID = signingID
        self.teamID = teamID
        self.path = path
        self.displayName = displayName
        self.isSystem = isSystem
    }
}

public enum AppIdentityResolver {
    /// Best-effort resolution; a process that died or resists inspection
    /// yields the fallback name unsigned-style.
    public static func resolve(pid: Int32, fallbackName: String) -> ResolvedIdentity {
        var code: SecCode?
        let attributes = [kSecGuestAttributePid: pid as CFNumber] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
              let dynamicCode = code else {
            return ResolvedIdentity(signingID: nil, teamID: nil, path: nil,
                                    displayName: fallbackName, isSystem: false)
        }

        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(dynamicCode, [], &staticCode) == errSecSuccess,
              let fixedCode = staticCode else {
            return ResolvedIdentity(signingID: nil, teamID: nil, path: nil,
                                    displayName: fallbackName, isSystem: false)
        }

        var info: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(fixedCode, flags, &info) == errSecSuccess,
              let dict = info as? [String: Any] else {
            return ResolvedIdentity(signingID: nil, teamID: nil, path: nil,
                                    displayName: fallbackName, isSystem: false)
        }

        let signingID = dict[kSecCodeInfoIdentifier as String] as? String
        let teamID = dict[kSecCodeInfoTeamIdentifier as String] as? String
        let executable = dict[kSecCodeInfoMainExecutable as String] as? URL
        let path = executable?.path

        // Apple platform binaries: com.apple.* signing ID and no team ID.
        let isSystem = (signingID?.hasPrefix("com.apple.") ?? false) && teamID == nil

        return ResolvedIdentity(signingID: signingID, teamID: teamID, path: path,
                                displayName: displayName(path: path, signingID: signingID,
                                                         fallback: fallbackName),
                                isSystem: isSystem)
    }

    /// Prefer the .app bundle name; else the executable filename; else fallback.
    static func displayName(path: String?, signingID: String?, fallback: String) -> String {
        if let path {
            let components = path.components(separatedBy: "/")
            if let bundle = components.last(where: { $0.hasSuffix(".app") }) {
                return String(bundle.dropLast(4))
            }
            if let file = components.last, !file.isEmpty {
                return file
            }
        }
        if let signingID, !signingID.isEmpty {
            return signingID.components(separatedBy: ".").last ?? signingID
        }
        return fallback
    }
}
