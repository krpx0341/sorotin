#!/usr/bin/env bash
# Fail CI if the AI key file or an OpenAI-style key is in git.
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

hits=$(git grep -I -l -E 'sk-[a-zA-Z0-9]{20,}|sk-or-[a-zA-Z0-9]{16,}' -- . \
  ':!HANDOFF.md' ':!README.md' ':!AGENTS.md' ':!scripts/secret-scan.sh' || true)
if [[ -n "$hits" ]]; then
  echo "FAIL possible API key in:"
  printf '%s\n' "$hits"
  exit 1
fi

echo "ok  data/settings.json is not in git"
echo "ok  no OpenAI-style keys in tracked files"
