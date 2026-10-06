#!/usr/bin/env bash
# herdr: terminal workspace manager for running several AI coding agents.
#
# Docs: https://herdr.dev/docs/install/
#
# The official installer downloads a single binary for your OS/architecture,
# checks its SHA-256 against herdr.dev's release manifest and puts it in
# ~/.local/bin (override with HERDR_INSTALL_DIR). It asks no questions.
# Updating later is `herdr update`, so this script only installs when herdr is
# missing.
set -euo pipefail

BIN="${HERDR_INSTALL_DIR:-$HOME/.local/bin}/herdr"

if command -v herdr >/dev/null || [[ -x "$BIN" ]]; then
  version="$({ command -v herdr >/dev/null && herdr --version; } || "$BIN" --version)"
  echo "herdr: already installed ($version)"
  exit 0
fi

echo "herdr: running the official installer (https://herdr.dev/install.sh)"
curl -fsSL https://herdr.dev/install.sh | sh

echo "herdr: installed $("$BIN" --version)"
