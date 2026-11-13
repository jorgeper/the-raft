#!/bin/bash
# Installs gargoyle-helperd as a launchd daemon (Tap B capture, spec §2.2).
# Usage: sudo scripts/install-helper.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "error: must run as root — sudo $0" >&2
    exit 1
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ALLOW_UID="${SUDO_UID:-$(id -u)}"
LABEL="com.gargoyle.helperd"
BIN="/Library/PrivilegedHelperTools/gargoyle-helperd"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
SOCKET="/var/run/gargoyle.sock"

# Build as the invoking user so .build/ doesn't become root-owned.
echo "building gargoyle-helperd (release)…"
sudo -u "#${ALLOW_UID}" swift build -c release --package-path "$REPO_DIR" --product gargoyle-helperd

mkdir -p /Library/PrivilegedHelperTools
install -m 755 -o root -g wheel "$REPO_DIR/.build/release/gargoyle-helperd" "$BIN"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BIN}</string>
        <string>--socket</string><string>${SOCKET}</string>
        <string>--allow-uid</string><string>${ALLOW_UID}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardErrorPath</key><string>/var/log/gargoyle-helperd.log</string>
</dict>
</plist>
PLIST
chmod 644 "$PLIST"

launchctl bootout "system/${LABEL}" 2>/dev/null || true
launchctl bootstrap system "$PLIST"

echo "installed: ${LABEL}"
echo "  binary : ${BIN}"
echo "  socket : ${SOCKET} (uid ${ALLOW_UID} only)"
echo "  log    : /var/log/gargoyle-helperd.log"
