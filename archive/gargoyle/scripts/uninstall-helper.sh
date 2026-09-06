#!/bin/bash
# Removes the gargoyle-helperd launchd daemon. Usage: sudo scripts/uninstall-helper.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "error: must run as root — sudo $0" >&2
    exit 1
fi

LABEL="com.gargoyle.helperd"
launchctl bootout "system/${LABEL}" 2>/dev/null || true
rm -f "/Library/LaunchDaemons/${LABEL}.plist" \
      /Library/PrivilegedHelperTools/gargoyle-helperd \
      /var/run/gargoyle.sock
echo "removed ${LABEL}"
