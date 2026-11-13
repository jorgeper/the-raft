import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())

func printUsage() {
    print("""
    gargoyle-spike — Phase 0 spike for Gargoyle (spec.md)

    USAGE:
      sudo gargoyle-spike capture [--duration <seconds>]
          Capture on the pktap pseudo-interface, print new flows with
          per-process attribution, and a per-app summary on exit (Ctrl-C
          or after --duration).

      gargoyle-spike probe
          Report whether this machine can likely activate the
          NEFilterDataProvider system extension (Tap A, spec §3).
    """)
}

switch arguments.first {
case "probe":
    exit(runProbe())
case "capture", nil:
    var duration: TimeInterval? = nil
    if let idx = arguments.firstIndex(where: { $0 == "--duration" || $0 == "-d" }) {
        guard arguments.count > idx + 1, let secs = TimeInterval(arguments[idx + 1]), secs > 0 else {
            fputs("error: --duration requires a positive number of seconds\n", stderr)
            exit(2)
        }
        duration = secs
    }
    exit(runCapture(duration: duration))
case "--help", "-h", "help":
    printUsage()
    exit(0)
default:
    fputs("unknown command: \(arguments[0])\n\n", stderr)
    printUsage()
    exit(2)
}
