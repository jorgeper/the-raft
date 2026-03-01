#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   export AZURE_SPEECH_KEY=xxxx
#   export AZURE_SPEECH_REGION=eastus
#   ./Scripts/set_env.sh [SCHEME_PATH]
#
# Optional overrides also accepted as args: SPEECH_KEY=... SPEECH_REGION=...
# If SCHEME_PATH is omitted, the script will try to find your .xcscheme automatically.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

KEY="${AZURE_SPEECH_KEY:-}"
REGION="${AZURE_SPEECH_REGION:-}"
SCHEME_PATH="${3:-}"

for arg in "$@"; do
  case "$arg" in
    SPEECH_KEY=*) KEY="${arg#*=}" ;;
    SPEECH_REGION=*) REGION="${arg#*=}" ;;
    *.xcscheme) SCHEME_PATH="$arg" ;;
  esac
done

if [[ -z "$KEY" || -z "$REGION" ]]; then
  echo "Provide SPEECH_KEY and SPEECH_REGION, e.g.:"
  echo "  export AZURE_SPEECH_KEY=sk_..."
  echo "  export AZURE_SPEECH_REGION=eastus"
  echo "  ./Scripts/set_env.sh"
  exit 1
fi

if [[ -z "$SCHEME_PATH" ]]; then
  # Try common locations
  if [[ -f "$ROOT_DIR/MeetingTranscriber.xcodeproj/xcshareddata/xcschemes/MeetingTranscriber.xcscheme" ]]; then
    SCHEME_PATH="$ROOT_DIR/MeetingTranscriber.xcodeproj/xcshareddata/xcschemes/MeetingTranscriber.xcscheme"
  else
    # Fallback: first .xcscheme found
    SCHEME_PATH=$(find "$ROOT_DIR" -name "*.xcscheme" | head -n 1 || true)
  fi
fi

if [[ -z "$SCHEME_PATH" || ! -f "$SCHEME_PATH" ]]; then
  echo "Could not locate an .xcscheme file. Pass one explicitly as 3rd arg."
  exit 1
fi

echo "Updating scheme: $SCHEME_PATH"
/usr/bin/env python3 "$ROOT_DIR/Scripts/set_xcode_env.py" "$SCHEME_PATH" "$KEY" "$REGION"
echo "Done. Reopen the .xcworkspace if open, or Product → Clean Build Folder."

