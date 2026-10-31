#!/usr/bin/env bash
# Fail CI if the AI key file or a common API token is tracked in git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if git ls-files --error-unmatch data/settings.json >/dev/null 2>&1; then
  echo "FAIL data/settings.json is tracked. API keys must stay local."
  exit 1
fi

if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -v '.env.example'; then
  echo "FAIL env file is tracked"
  exit 1
fi

# Token shapes only. A short prefix (sk-, AIza, ghp_, xoxb-) is not a hit.
# This file is excluded so the patterns themselves are not a hit.
pattern='sk-[A-Za-z0-9]{20,}|sk-or-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----'

hits=$(git grep -I -l -E "$pattern" -- . \
  ':!HANDOFF.md' ':!README.md' ':!AGENTS.md' ':!scripts/secret-scan.sh' || true)
if [[ -n "$hits" ]]; then
  echo "FAIL possible API key in:"
  printf '%s\n' "$hits"
  exit 1
fi

echo "ok  data/settings.json is not in git"
echo "ok  no OpenAI, Google, GitHub, Slack, or PEM private keys in tracked files"
