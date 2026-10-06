#!/usr/bin/env bash
# base: the packages every other module builds on.
#
# Usage:
#   bash modules/base/install.sh          install missing packages (asks for sudo)
#   bash modules/base/install.sh --list   print the package list and exit
#
# Safe to run any number of times: packages that are already installed are
# skipped, and apt is only touched when something is missing.
set -euo pipefail

# The single source of truth for this module. modules/base/index.ts reads it
# via `--list` for its health check.
PACKAGES=(
  git
  curl             # most official installers are `curl ... | sh`
  wget
  ca-certificates  # HTTPS trust store for curl, git and apt repos
  unzip
  jq
  build-essential  # gcc, make: native Node/Python packages compile against these
  ripgrep          # rg: fast search, used heavily by coding agents
  fd-find          # fd: fast file finder (the binary is called `fdfind` on Debian/Ubuntu)
)

if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${PACKAGES[@]}"
  exit 0
fi

# 1. Find out which packages are missing.
#    dpkg-query prints "install ok installed" for packages that are fully installed.
missing=()
for pkg in "${PACKAGES[@]}"; do
  if ! dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    missing+=("$pkg")
  fi
done

# 2. Install only what's missing. DEBIAN_FRONTEND keeps apt from asking questions.
if (( ${#missing[@]} == 0 )); then
  echo "base: all packages already installed"
else
  echo "base: installing ${missing[*]}"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi

# 3. Debian/Ubuntu name the fd binary `fdfind` (a different `fd` package already existed).
#    Give it its usual name in ~/.local/bin, unless an `fd` already exists.
if command -v fdfind >/dev/null && ! command -v fd >/dev/null && [[ ! -e "$HOME/.local/bin/fd" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$(command -v fdfind)" "$HOME/.local/bin/fd"
  echo "base: linked ~/.local/bin/fd → fdfind"
fi
