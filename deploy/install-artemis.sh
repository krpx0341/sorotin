#!/usr/bin/env bash
# Install the license server on Artemis (Armbian aarch64 STB).
# Run from the repo, or copy the aarch64 binary + this folder to the box:
#   bash deploy/install-artemis.sh /path/to/sorotin-license
set -euo pipefail
BIN="${1:-}"
if [[ -z "$BIN" ]]; then
  echo "usage: $0 /path/to/sorotin-license" >&2
  exit 1
fi
install -d -m 0755 /var/lib/sorotin-license
install -m 0755 "$BIN" /usr/local/bin/sorotin-license
install -m 0644 "$(dirname "$0")/sorotin-license.service" /etc/systemd/system/sorotin-license.service
if [[ ! -f /var/lib/sorotin-license/ed25519.sec ]]; then
  /usr/local/bin/sorotin-license --data /var/lib/sorotin-license init
fi
systemctl daemon-reload
systemctl enable --now sorotin-license.service
systemctl --no-pager --full status sorotin-license.service || true
echo
echo "pubkey:"
cat /var/lib/sorotin-license/ed25519.pub
echo
echo "mint a key:  sorotin-license --data /var/lib/sorotin-license mint --seats 1 --label voyager"
echo "health:      curl -s http://127.0.0.1:8787/health"
echo "from tailnet: http://artemis:8787   (MagicDNS) or http://100.111.29.105:8787"
echo "copy pubkey into src/lib/license-pub.ts then rebuild the desktop app"
