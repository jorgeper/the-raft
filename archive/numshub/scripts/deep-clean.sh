#!/bin/bash
# Removes every trace of Numshub so the next install is a true first run:
# binary, app data (settings/models/history), permissions (mic +
# accessibility), preferences, WebKit storage, caches, saved state, and the
# launch-at-login agent. Models are large — this deletes them too.
set -uo pipefail

BUNDLE_ID="com.numshub.app"

echo "Quitting Numshub…"
pkill -x numshub 2>/dev/null

echo "Removing the app bundle…"
rm -rf /Applications/Numshub.app

echo "Removing app data (settings, history, downloaded models)…"
rm -rf "$HOME/Library/Application Support/$BUNDLE_ID"

echo "Resetting permissions (microphone + accessibility)…"
tccutil reset Microphone "$BUNDLE_ID" >/dev/null 2>&1
tccutil reset Accessibility "$BUNDLE_ID" >/dev/null 2>&1

echo "Removing preferences (incl. menu-bar item state)…"
defaults delete "$BUNDLE_ID" >/dev/null 2>&1
rm -f "$HOME/Library/Preferences/$BUNDLE_ID.plist"

echo "Removing WebKit storage, caches, and saved state…"
rm -rf "$HOME/Library/WebKit/$BUNDLE_ID" \
       "$HOME/Library/Caches/$BUNDLE_ID" \
       "$HOME/Library/HTTPStorages/$BUNDLE_ID" \
       "$HOME/Library/Saved Application State/$BUNDLE_ID.savedState"

echo "Removing the launch-at-login agent (if any)…"
rm -f "$HOME/Library/LaunchAgents/$BUNDLE_ID.plist"

# Menu-bar allowance state lives in Control Center; nudge it to forget.
killall ControlCenter 2>/dev/null

echo
echo "Done. Numshub is fully removed. Notes:"
echo "  - The test-harness model cache (~/.cache/numshub-validate) was kept;"
echo "    delete it too if you want: rm -rf ~/.cache/numshub-validate"
echo "  - Next install (npm run install:app) will be a true first run:"
echo "    mic prompt, accessibility, menu bar, model download — all fresh."
