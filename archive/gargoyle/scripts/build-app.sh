#!/bin/bash
# Assembles dist/Gargoyle.app from the SwiftPM build (ad-hoc signed).
# A proper Xcode project takes over in Phase 2 when the system extension
# target and real signing arrive.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "building GargoyleApp (release)…"
swift build -c release --product GargoyleApp

APP="dist/Gargoyle.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cp .build/release/GargoyleApp "$APP/Contents/MacOS/Gargoyle"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>com.gargoyle.app</string>
    <key>CFBundleName</key><string>Gargoyle</string>
    <key>CFBundleDisplayName</key><string>Gargoyle</string>
    <key>CFBundleExecutable</key><string>Gargoyle</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP"
echo "built $APP"
echo "run: open $APP    (menu-bar shield icon)"
