#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Installing XcodeGen..."
  brew install xcodegen
fi

if ! command -v pod >/dev/null 2>&1; then
  echo "CocoaPods not found. Install via Homebrew (recommended): brew install cocoapods"
  echo "Or install via RubyGems using a recent Ruby version: gem install cocoapods"
  exit 1
fi

echo "Generating Xcode project..."
xcodegen generate --use-cache

echo "Installing pods..."
pod install --repo-update

echo "Done. Open MeetingTranscriber-iOS/MeetingTranscriber.xcworkspace in Xcode."

