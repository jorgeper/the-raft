#!/usr/bin/env bash
# Dev-only model fetcher. The app itself never touches the network (spec §3.2;
# in-app download arrives with the M4 model manager).
set -euo pipefail
MODEL="${1:-small}"
DIR="${MINUTES_MODELS_DIR:-$HOME/Library/Application Support/com.jorgeper.minutes/models}"
mkdir -p "$DIR"
F="$DIR/ggml-$MODEL.bin"
[ -f "$F" ] && { echo "already present: $F"; exit 0; }
curl -L --fail -o "$F.part" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
mv "$F.part" "$F"
echo "downloaded: $F"
