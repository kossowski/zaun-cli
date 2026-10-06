#!/usr/bin/env bash
# git-config: your git identity plus a few sensible global defaults.
#
# Usage:
#   bash modules/git-config/install.sh [--name "Your Name"] [--email you@example.com]
#   bash modules/git-config/install.sh --list      print the defaults (key=value) and exit
#
# Without --name/--email the identity already in ~/.gitconfig is kept.
# Everything goes into your global config (~/.gitconfig) via `git config --global`.
# Safe to run any number of times.
set -euo pipefail

# The defaults. modules/git-config/index.ts reads them via `--list` for its check.
DEFAULTS=(
  # New repositories start on `main` (git's built-in default is still `master`).
  "init.defaultBranch=main"
  # `git pull` merges (git's classic behaviour). Setting it explicitly silences
  # the "you have divergent branches" hint. Prefer rebasing? Use `true`.
  "pull.rebase=false"
  # The first `git push` on a new branch creates the remote branch and tracks
  # it, so no `--set-upstream origin <branch>` dance (handy for agents too).
  "push.autoSetupRemote=true"
  # Forget remote branches that were deleted on the server when fetching.
  "fetch.prune=true"
)

if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${DEFAULTS[@]}"
  exit 0
fi

name="" email=""
while (( $# > 0 )); do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --email) email="$2"; shift 2 ;;
    *) echo "git-config: unknown option: $1" >&2; exit 2 ;;
  esac
done

# Set a global key only if it differs, and say what changed.
set_global() {
  local key="$1" value="$2" current
  current="$(git config --global --get "$key" || true)"
  if [[ "$current" == "$value" ]]; then
    echo "git-config: $key already '$value'"
  else
    git config --global "$key" "$value"
    echo "git-config: set $key = '$value'"
  fi
}

# 1. Identity.
for pair in "user.name=$name" "user.email=$email"; do
  key="${pair%%=*}" value="${pair#*=}"
  if [[ -n "$value" ]]; then
    set_global "$key" "$value"
  elif [[ -n "$(git config --global --get "$key" || true)" ]]; then
    echo "git-config: keeping existing $key"
  else
    echo "git-config: warning: $key is not set. Set it with: git config --global $key \"...\"" >&2
  fi
done

# 2. Defaults.
for pair in "${DEFAULTS[@]}"; do
  set_global "${pair%%=*}" "${pair#*=}"
done
