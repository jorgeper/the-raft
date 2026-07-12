import Foundation

/// Reports whether this machine looks able to activate an NEFilterDataProvider
/// system extension (spec §3). This is a heuristic report: the definitive test
/// requires the signed Phase 1 app bundle attempting real activation.
func runProbe() -> Int32 {
    print("Gargoyle Tap A feasibility probe")
    print("=================================\n")

    let enrollment = shell("/usr/bin/profiles", ["status", "-type", "enrollment"])
    section("MDM enrollment (profiles status -type enrollment)", enrollment)

    let sysext = shell("/usr/bin/systemextensionsctl", ["list"])
    section("Installed system extensions (systemextensionsctl list)", sysext)

    let sip = shell("/usr/bin/csrutil", ["status"])
    section("System Integrity Protection (csrutil status)", sip)

    let groups = shell("/usr/bin/id", ["-Gn"])
    section("Current user groups (id -Gn)", groups)

    print("Interpretation")
    print("--------------")
    let enrolled = enrollment.output.contains("Yes")
    let isAdmin = groups.output.split(separator: " ").map(String.init).contains("admin")
    let hasNetworkExt = sysext.output.contains("com.apple.system_extension.network_extension")

    if enrolled {
        print("• Device is MDM-enrolled: activating a system extension may additionally require")
        print("  the MDM policy to allow-list Gargoyle's Team ID. Expect Tap B (monitor-only)")
        print("  unless IT approves; Gargoyle should auto-fallback per spec §3.")
    } else {
        print("• No MDM enrollment detected: system-extension approval is a local")
        print("  System Settings click. Tap A (full firewall mode) should be attainable.")
    }
    print(isAdmin
        ? "• User is in the admin group: can approve extensions in System Settings."
        : "• User is NOT in the admin group: cannot approve system extensions locally.")
    if hasNetworkExt {
        print("• At least one network system extension is already active — extensions of this")
        print("  type demonstrably load on this machine (filters can coexist).")
    }
    print("\nDefinitive check: Phase 1's signed app bundle must call")
    print("OSSystemExtensionRequest.activationRequest and observe the result.")
    return 0
}

private func section(_ title: String, _ result: (status: Int32, output: String)) {
    print(title)
    print(String(repeating: "-", count: title.count))
    if result.output.isEmpty {
        print("(no output, exit \(result.status))")
    } else {
        print(result.output.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    print("")
}

private func shell(_ path: String, _ args: [String]) -> (status: Int32, output: String) {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: path)
    proc.arguments = args
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = pipe
    do {
        try proc.run()
    } catch {
        return (127, "failed to run \(path): \(error.localizedDescription)")
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    proc.waitUntilExit()
    return (proc.terminationStatus, String(decoding: data, as: UTF8.self))
}
