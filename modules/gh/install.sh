#!/usr/bin/env bash
# gh: the GitHub CLI from GitHub's official apt repository.
#
# Follows https://github.com/cli/cli/blob/trunk/docs/install_linux.md
# (Debian/Ubuntu, "Official sources"). The distro's own archive also has a `gh`
# package, but it lags far behind; GitHub's repo gets every release, and
# `apt upgrade` keeps it current.
#
# Safe to run any number of times. A gh that didn't come from apt (a manual
# binary, Homebrew, ...) is left alone; the distro's `gh` package is upgraded in
# place to GitHub's (same package name, newer version).
set -euo pipefail

# 1. Respect a gh that apt doesn't manage.
if command -v gh >/dev/null && ! dpkg-query -W -f='${Status}' gh 2>/dev/null | grep -q "install ok installed"; then
  echo "gh: found $(command -v gh) (not installed by apt), leaving it as it is"
  exit 0
fi

# 2. Add GitHub's apt repository, unless some file already points at it
#    (two entries with different keyring paths make apt refuse to work).
if grep -rqs "cli.github.com/packages" /etc/apt/sources.list /etc/apt/sources.list.d/; then
  echo "gh: apt repository already configured"
  repo_added=false
else
  echo "gh: adding GitHub's apt repository"
  # The key is referenced only by this repo (signed-by=...), so it can't vouch
  # for packages from anywhere else.
  sudo mkdir -p -m 755 /etc/apt/keyrings
  keyring="$(mktemp)"
  trap 'rm -f "$keyring"' EXIT
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$keyring"
  sudo install -m 0644 "$keyring" /etc/apt/keyrings/githubcli-archive-keyring.gpg
  sudo mkdir -p -m 755 /etc/apt/sources.list.d
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  repo_added=true
fi

# 3. Install gh, or switch the distro's older gh to GitHub's build right after
#    adding the repo. Otherwise there's nothing to do (updates: `apt upgrade`).
if ! command -v gh >/dev/null || $repo_added; then
  echo "gh: installing gh from GitHub's repository"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh
else
  echo "gh: already installed ($(gh --version | head -n1))"
fi

echo "gh: next, log in with \`gh auth login\` or set GH_TOKEN (see docs/github-token.md)"
