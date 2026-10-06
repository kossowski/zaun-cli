#!/usr/bin/env bash
# tailscale: private network access to this machine (SSH, dev servers) from
# your other devices, without opening ports to the internet.
#
# Uses Tailscale's official installer (https://tailscale.com/kb/1031/install-linux).
# On Ubuntu and Debian it adds Tailscale's apt repository (pkgs.tailscale.com) and installs
# the `tailscale` package, so later updates arrive with `apt upgrade`.
#
# It does NOT log you in: `sudo tailscale up` opens a login URL, which needs
# you. Run it yourself afterwards (add `--ssh` to enable Tailscale SSH).
#
# Safe to run any number of times: an existing install is left alone.
set -euo pipefail

# 1. Install, unless the `tailscale` command already exists (from any source).
if command -v tailscale >/dev/null; then
  echo "tailscale: already installed ($(tailscale version 2>/dev/null | head -n1))"
else
  echo "tailscale: running the official installer"
  # Download first, then run: a failed download can't execute half a script.
  # The installer calls sudo itself and doesn't ask questions.
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://tailscale.com/install.sh -o "$installer"
  sh "$installer"
fi

# 2. The daemon (tailscaled) must run for anything to work. The package
#    enables it on systemd machines; make sure, in case it was disabled.
if [[ -d /run/systemd/system ]]; then
  if systemctl is-enabled --quiet tailscaled && systemctl is-active --quiet tailscaled; then
    echo "tailscale: tailscaled already enabled and running"
  else
    echo "tailscale: enabling and starting tailscaled"
    sudo systemctl enable --now tailscaled
  fi
else
  echo "tailscale: no systemd here, so tailscaled is not started automatically"
fi

echo "tailscale: next, log in with \`sudo tailscale up\` (optionally \`--ssh\`)"
