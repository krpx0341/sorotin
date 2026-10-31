#!/usr/bin/env bash
# Finish a Linux AppImage after `pnpm tauri:build` (or after a partial linuxdeploy).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPDIR="$ROOT/src-tauri/target/release/bundle/appimage/Sorotin.AppDir"
OUT="$ROOT/dist/Sorotin-0.1.0-linux-x86_64.AppImage"
TOOL="${APPIMAGETOOL:-/tmp/appimagetool-x86_64.AppImage}"

if [[ ! -d "$APPDIR" ]]; then
  echo "missing $APPDIR — run: CARGO_TARGET_DIR=$ROOT/src-tauri/target pnpm tauri:build" >&2
  exit 1
fi

if [[ ! -x "$TOOL" ]]; then
  curl -fsSL -o "$TOOL" \
    https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$TOOL"
fi

chmod -R a+rX "$APPDIR"

# Replace linuxdeploy ELF AppRun — it sets GST_* to empty AppDir plugin dirs
# and WebKitWebProcess SIGABRTs (black window). Keep usr/bin/sorotin as the ELF
# so the window class stays "sorotin".
cp "$ROOT/scripts/sorotin-appimage-apprun.sh" "$APPDIR/AppRun"
chmod a+rx "$APPDIR/AppRun"
if file -b "$APPDIR/AppRun" | grep -q ELF; then
  echo "AppRun is still ELF — WebKit will crash. Refusing to pack." >&2
  exit 1
fi
if [[ -x "$APPDIR/usr/bin/sorotin.bin" && ! -x "$APPDIR/usr/bin/sorotin" ]]; then
  mv -f "$APPDIR/usr/bin/sorotin.bin" "$APPDIR/usr/bin/sorotin"
fi
chmod a+rx "$APPDIR/usr/bin/sorotin"

mkdir -p "$ROOT/dist"
export APPIMAGE_EXTRACT_AND_RUN=1 ARCH=x86_64
"$TOOL" "$APPDIR" "$OUT"
chmod a+rx "$OUT"
ls -lh "$OUT"
