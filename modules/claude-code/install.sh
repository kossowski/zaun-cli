#!/usr/bin/env bash
# claude-code: Anthropic's Claude Code CLI, via the official native installer.
#
# Docs: https://code.claude.com/docs/en/setup
#
# The native installer downloads a self-contained binary (no Node.js needed)
# into ~/.local/share/claude/versions/ and points ~/.local/bin/claude at it.
# It runs as your normal user and must NOT be run with sudo. Native installs
# update themselves in the background, so once Claude Code is there this
# script leaves it alone.
set -euo pipefail

BIN="$HOME/.local/bin/claude"

if command -v claude >/dev/null || [[ -x "$BIN" ]]; then
  version="$({ command -v claude >/dev/null && claude --version; } || "$BIN" --version)"
  echo "claude-code: already installed ($version)"
  exit 0
fi

echo "claude-code: running the official installer (https://claude.ai/install.sh)"
# The script verifies the binary's SHA-256 against Anthropic's release
# manifest, then runs `claude install` to set up the launcher.
curl -fsSL https://claude.ai/install.sh | bash

echo "claude-code: installed $("$BIN" --version)"
echo "claude-code: run \`claude\` to log in"
