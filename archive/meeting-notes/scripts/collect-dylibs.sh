#!/usr/bin/env bash
# Collects the sherpa-onnx runtime dylibs into src-tauri/dylibs/ so the tauri
# bundler can copy them into Minutes.app/Contents/Frameworks (see
# bundle.macOS.frameworks in tauri.conf.json). Runs from beforeBuildCommand.
#
# Builds only the sherpa-rs dependency (not the app crate) because the app's
# build script validates that dylibs/ already exists — building the full app
# here would be circular.
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

need() { [ ! -f "dylibs/$1" ]; }

if need libsherpa-onnx-c-api.dylib || need libonnxruntime.1.17.1.dylib; then
  MACOSX_DEPLOYMENT_TARGET=11.0 cargo build --release -p sherpa-rs
  mkdir -p dylibs
  for lib in libsherpa-onnx-c-api.dylib libonnxruntime.1.17.1.dylib; do
    src=$(find target/release -name "$lib" -not -path '*/dylibs/*' | head -1)
    [ -n "$src" ] || { echo "ERROR: $lib not found under target/release" >&2; exit 1; }
    cp -f "$src" dylibs/
  done
fi
echo "dylibs ready: $(ls dylibs)"
