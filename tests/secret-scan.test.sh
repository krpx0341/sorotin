#!/usr/bin/env bash
# The new secret-scan patterns must catch fake tokens and ignore ordinary source.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_SRC="$ROOT/scripts/secret-scan.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

repeat() {
  local ch="$1" n="$2" i out=""
  for ((i = 0; i < n; i++)); do
    out+="$ch"
  done
  printf '%s' "$out"
}

init_repo() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/scripts" "$dir/src"
  cp "$SCAN_SRC" "$dir/scripts/secret-scan.sh"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.email "secret-scan-test@example.com"
  git -C "$dir" config user.name "secret-scan-test"
  git -C "$dir" config commit.gpgsign false
  cat > "$dir/src/normal.ts" <<'EOF'
// Ordinary module. Prefixes below are too short or the wrong shape to be tokens.
export const skill = "ask-the-editor-for-a-shorter-title";
export const openaiPrefix = "sk-abc";
export const openaiWords = "sk-not-a-real-token-because-of-hyphens";
export const googlePrefix = "AIza";
export const githubPrefix = "ghp_short";
export const slackPrefix = "xoxb-short";
export const slackWord = "xox";
export const settingsPath = "data/settings.json";
export const publicKey = [
  "-----BEGIN PUBLIC KEY-----",
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A",
  "-----END PUBLIC KEY-----",
].join("\n");
EOF
  printf '%s\n' 'API_KEY=replace-me' > "$dir/.env.example"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "normal files"
}

expect_pass() {
  local dir="$1" name="$2"
  if bash "$dir/scripts/secret-scan.sh" >"$dir/scan.out" 2>&1; then
    echo "ok  $name"
  else
    echo "FAIL $name should pass"
    cat "$dir/scan.out"
    exit 1
  fi
}

expect_fail() {
  local dir="$1" name="$2"
  if bash "$dir/scripts/secret-scan.sh" >"$dir/scan.out" 2>&1; then
    echo "FAIL $name was not detected"
    exit 1
  fi
  echo "ok  detected $name"
}

commit_leak() {
  local dir="$1"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "leak fixture"
}

clean="$TMP/clean"
init_repo "$clean"
expect_pass "$clean" "normal files"

openai="$TMP/openai"
init_repo "$openai"
printf 'token=%s\n' "sk-$(repeat a 24)" > "$openai/src/leak.txt"
commit_leak "$openai"
expect_fail "$openai" "openai sk-"

openrouter="$TMP/openrouter"
init_repo "$openrouter"
printf 'token=%s\n' "sk-or-$(repeat b 20)" > "$openrouter/src/leak.txt"
commit_leak "$openrouter"
expect_fail "$openrouter" "sk-or-"

google="$TMP/google"
init_repo "$google"
printf 'token=%s\n' "AIza$(repeat A 35)" > "$google/src/leak.txt"
commit_leak "$google"
expect_fail "$google" "google AIza"

github="$TMP/github"
init_repo "$github"
printf 'token=%s\n' "ghp_$(repeat a 36)" > "$github/src/leak.txt"
commit_leak "$github"
expect_fail "$github" "github ghp_"

slack="$TMP/slack"
init_repo "$slack"
printf 'token=%s\n' "xoxb-$(repeat a 24)" > "$slack/src/leak.txt"
commit_leak "$slack"
expect_fail "$slack" "slack xox"

pem="$TMP/pem"
init_repo "$pem"
{
  printf '%s\n' "-----BEGIN $(printf '%s' 'PRIVATE KEY-----')"
  printf '%s\n' "$(repeat A 40)"
  printf '%s\n' "-----END $(printf '%s' 'PRIVATE KEY-----')"
} > "$pem/src/leak.txt"
commit_leak "$pem"
expect_fail "$pem" "pem private key"

pem_rsa="$TMP/pem-rsa"
init_repo "$pem_rsa"
{
  printf '%s\n' "-----BEGIN RSA $(printf '%s' 'PRIVATE KEY-----')"
  printf '%s\n' "$(repeat B 40)"
  printf '%s\n' "-----END RSA $(printf '%s' 'PRIVATE KEY-----')"
} > "$pem_rsa/src/leak.txt"
commit_leak "$pem_rsa"
expect_fail "$pem_rsa" "pem rsa private key"

settings="$TMP/settings"
init_repo "$settings"
mkdir -p "$settings/data"
printf '%s\n' '{"baseUrl":"http://127.0.0.1:9","apiKey":"example","model":"local","enabled":false}' \
  > "$settings/data/settings.json"
commit_leak "$settings"
expect_fail "$settings" "tracked data/settings.json"
