#!/usr/bin/env bash
# node: Node.js LTS via fnm, plus pnpm via corepack.
#
# Why fnm: it's a single fast binary, installs Node per user (no sudo, no
# system packages that lag behind) and switches versions per project via
# .node-version / .nvmrc. zaun's zsh config (config/zsh/zaun.zsh) loads it.
#
# bootstrap.sh may already have installed fnm and Node to run zaun itself;
# then this script only verifies and finishes the setup (default + pnpm).
# Safe to run any number of times.
set -euo pipefail

export FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"

# 1. fnm, with the official installer.
#    --install-dir: a fixed place that bootstrap.sh and bin/zaun also look at.
#    --skip-shell:  don't edit ~/.zshrc / ~/.bashrc; zaun.zsh does the shell setup.
if [[ -x "$FNM_DIR/fnm" ]]; then
  echo "node: fnm already installed ($("$FNM_DIR/fnm" --version))"
else
  echo "node: installing fnm into $FNM_DIR"
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$FNM_DIR" --skip-shell
fi
export PATH="$FNM_DIR:$PATH"

# 2. The current Node LTS, made the default for new shells.
#    `fnm install --lts` also creates the alias `lts-latest`.
if fnm list | grep -q 'lts-latest'; then
  echo "node: Node LTS already installed"
else
  echo "node: installing Node.js LTS"
  fnm install --lts
fi
# The `default` alias is what `fnm env` activates in every new shell.
if fnm list | grep -q 'default'; then
  echo "node: default Node already set ($(fnm exec --using=default node --version))"
else
  echo "node: setting Node LTS as default"
  fnm default lts-latest
fi

# Use the default Node for the rest of this script (`fnm env` activates it).
eval "$(fnm env --shell bash)"
node_bin="$(dirname "$(command -v node)")"

# 3. pnpm via corepack. corepack ships with Node up to v24; newer Node versions
#    dropped it, so install it from npm there. `corepack enable` creates the
#    `pnpm` (and `yarn`) shims next to `node`; the right pnpm version is then
#    downloaded on first use (or the one a project's package.json asks for).
if [[ ! -x "$node_bin/corepack" ]]; then
  echo "node: installing corepack (not bundled with this Node version)"
  npm install --global --no-audit --no-fund corepack
fi
if [[ -e "$node_bin/pnpm" ]]; then
  echo "node: pnpm shim already enabled"
else
  echo "node: enabling pnpm via corepack"
  corepack enable pnpm
fi

# nvm and fnm fight over PATH. We never remove anything; just point it out.
if [[ -d "$HOME/.nvm" ]]; then
  echo "node: note: nvm found in ~/.nvm. Remove the nvm lines from ~/.zshrc so fnm's Node is used."
fi
