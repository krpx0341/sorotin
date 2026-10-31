#!/usr/bin/env bash
# Re-runnable checks for the Linux desktop shell. Does not transcribe video.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPDIR="$ROOT/src-tauri/target/release/bundle/appimage/Sorotin.AppDir"
fail=0
ok() { echo "ok  $1"; }
bad() { echo "FAIL $1"; fail=1; }

if file -b "$APPDIR/AppRun" | grep -qi script; then ok "AppRun is a shell script"; else bad "AppRun is a shell script"; fi
if grep -q 'unset GST_PLUGIN_SYSTEM_PATH' "$APPDIR/AppRun"; then ok "AppRun unsets GST isolation"; else bad "AppRun unsets GST isolation"; fi
if grep -q WEBKIT_DISABLE_DMABUF_RENDERER "$APPDIR/AppRun"; then ok "AppRun disables DMA-BUF"; else bad "AppRun disables DMA-BUF"; fi
if grep -q 'GDK_BACKEND=x11' "$APPDIR/AppRun"; then bad "AppRun must not force X11"; else ok "AppRun does not force X11"; fi
if grep -q '"maximized": true' "$ROOT/src-tauri/tauri.conf.json"; then ok "window maximized"; else bad "window maximized"; fi
if grep -q '"decorations": false' "$ROOT/src-tauri/tauri.conf.json"; then ok "window decorations off"; else bad "window decorations off"; fi
if grep -q hyprctl "$ROOT/src-tauri/src/lib.rs"; then bad "lib.rs must not call hyprctl"; else ok "lib.rs does not call hyprctl"; fi
if grep -q 'large-v3-turbo' "$ROOT/src/lib/whisper.ts" && grep -q 'large-v3-turbo' "$ROOT/scripts/transcribe.py"; then
  ok "whisper default is large-v3-turbo"
else
  bad "whisper default is large-v3-turbo"
fi
if test -f "$ROOT/src/app/api/export/route.ts"; then ok "export route exists"; else bad "export route exists"; fi

if curl -fsS -o /dev/null http://127.0.0.1:17300/; then
  html=$(curl -fsS http://127.0.0.1:17300/)
  if printf '%s' "$html" | grep -q 'data-shell="desktop"'; then ok "html data-shell=desktop"; else bad "html data-shell=desktop"; fi
  cover=$(curl -fsS http://127.0.0.1:17300/api/studios | python3 -c "import json,sys
j=json.load(sys.stdin)
clips=j['data']['items'][0].get('clips') or []
print(next((c['coverPath'] for c in clips if c.get('coverPath')),''))")
  if [[ -n "$cover" ]]; then
    code=$(curl -sS -o /tmp/sorotin-verify-cover.jpg -w "%{http_code}" "http://127.0.0.1:17300$cover")
    if [[ "$code" == "200" ]] && file /tmp/sorotin-verify-cover.jpg | grep -qi JPEG; then
      ok "cover JPEG 200"
    else
      bad "cover JPEG 200 ($code)"
    fi
  else
    bad "no coverPath on first studio"
  fi
else
  echo "skip live HTTP (127.0.0.1:17300 down)"
fi

exit "$fail"
