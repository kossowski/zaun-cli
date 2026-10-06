#!/usr/bin/env bash
# codex: OpenAI's Codex CLI, via the official standalone installer.
#
# Docs: https://github.com/openai/codex#installation
#
# The standalone installer needs no Node.js. It keeps each release under
# ~/.codex/packages/standalone/releases/, points .../standalone/current at the
# active one and symlinks ~/.local/bin/codex to it. Running it again updates
# Codex; Codex also offers updates itself. This script only installs when
# Codex is missing, so a second run changes nothing.
set -euo pipefail

BIN="$HOME/.local/bin/codex"

if command -v codex >/dev/null || [[ -x "$BIN" ]]; then
  version="$({ command -v codex >/dev/null && codex --version; } || "$BIN" --version)"
  echo "codex: already installed ($version)"
  exit 0
fi

echo "codex: running the official installer (https://chatgpt.com/codex/install.sh)"
# CODEX_NON_INTERACTIVE=1: don't ask "Start Codex now?" at the end.
# The installer only edits a shell profile when ~/.local/bin isn't on PATH;
# zaun's zsh setup takes care of PATH, the installer's block is harmless.
curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh

echo "codex: installed $("$BIN" --version)"
echo "codex: run \`codex login\` to sign in (on a headless machine: \`codex login --device-auth\`)"
