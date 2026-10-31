#!/usr/bin/env bash
# Cross-compile a GNU aarch64 binary for Artemis (Armbian bookworm).
# Arch: sudo pacman -S rust-aarch64-gnu aarch64-linux-gnu-gcc
set -euo pipefail
cd "$(dirname "$0")"
: "${CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER:=aarch64-linux-gnu-gcc}"
: "${CC_aarch64_unknown_linux_gnu:=aarch64-linux-gnu-gcc}"
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER CC_aarch64_unknown_linux_gnu
cargo build --release --target aarch64-unknown-linux-gnu
echo "binary: $(pwd)/target/aarch64-unknown-linux-gnu/release/sorotin-license"
