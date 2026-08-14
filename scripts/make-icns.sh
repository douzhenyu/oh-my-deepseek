#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ICON="build/icon_1024.png"
ICONSET="build/icon.iconset"

mkdir -p "$ICONSET"
sips -z 16   16   "$ICON" --out "$ICONSET/icon_16x16.png"        >/dev/null
sips -z 32   32   "$ICON" --out "$ICONSET/icon_16x16@2x.png"     >/dev/null
sips -z 32   32   "$ICON" --out "$ICONSET/icon_32x32.png"        >/dev/null
sips -z 64   64   "$ICON" --out "$ICONSET/icon_32x32@2x.png"     >/dev/null
sips -z 128  128  "$ICON" --out "$ICONSET/icon_128x128.png"      >/dev/null
sips -z 256  256  "$ICON" --out "$ICONSET/icon_128x128@2x.png"   >/dev/null
sips -z 256  256  "$ICON" --out "$ICONSET/icon_256x256.png"      >/dev/null
sips -z 512  512  "$ICON" --out "$ICONSET/icon_256x256@2x.png"   >/dev/null
sips -z 512  512  "$ICON" --out "$ICONSET/icon_512x512.png"      >/dev/null
sips -z 1024 1024 "$ICON" --out "$ICONSET/icon_512x512@2x.png"   >/dev/null

iconutil -c icns "$ICONSET" -o build/icon.icns
echo "Built build/icon.icns"
