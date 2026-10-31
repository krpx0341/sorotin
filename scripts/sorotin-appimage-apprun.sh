#!/bin/sh
# linuxdeploy's ELF AppRun points GStreamer at empty AppDir plugin dirs and
# shadows system GTK/WebKit via LD_LIBRARY_PATH. WebKit then SIGABRTs.
SELF=$(readlink -f "$0")
APPDIR=$(dirname "$SELF")
export PATH="$APPDIR/usr/bin:${PATH:-/usr/bin}"
unset GST_PLUGIN_SYSTEM_PATH GST_PLUGIN_PATH PYTHONHOME LD_LIBRARY_PATH
if [ -d /usr/lib/gstreamer-1.0 ]; then
  export GST_PLUGIN_SYSTEM_PATH_1_0=/usr/lib/gstreamer-1.0
else
  unset GST_PLUGIN_SYSTEM_PATH_1_0
fi
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
cd "$APPDIR" || exit 1
exec "$APPDIR/usr/bin/sorotin" "$@"
