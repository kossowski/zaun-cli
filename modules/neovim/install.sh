#!/usr/bin/env bash
# neovim: the latest stable Neovim from the official GitHub release.
#
# Usage:
#   bash modules/neovim/install.sh            install if nvim is missing
#   bash modules/neovim/install.sh --update   replace zaun's copy with the latest release
#
# The apt package is too old for most current plugins (0.9 on Ubuntu 24.04,
# 0.7 on Debian 12), so this downloads the release tarball for this CPU, checks
# its SHA-256 against the digest GitHub publishes for the asset, and unpacks it
# into ~/.local/opt/nvim with a symlink in ~/.local/bin. No sudo. An nvim
# installed some other way (apt, Homebrew, ...) is left alone.
set -euo pipefail

OPT_DIR="$HOME/.local/opt/nvim"
BIN_DIR="$HOME/.local/bin"
API=https://api.github.com/repos/neovim/neovim/releases/latest

update=false
case "${1:-}" in
  --update) update=true ;;
  "") ;;
  *) echo "neovim: unknown option: $1" >&2; exit 2 ;;
esac

if ! $update && { command -v nvim >/dev/null || [[ -x "$BIN_DIR/nvim" ]]; }; then
  nvim_bin="$(command -v nvim || echo "$BIN_DIR/nvim")"
  echo "neovim: already installed ($("$nvim_bin" --version | head -1))"
  exit 0
fi

case "$(uname -m)" in
  x86_64) arch=x86_64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "neovim: unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac
asset="nvim-linux-$arch.tar.gz"

# Release tag, download URL and digest ("sha256:<hex>") in one API call.
release="$(curl -fsSL "$API")" || { echo "neovim: could not reach the GitHub API" >&2; exit 1; }
tag="$(jq -r '.tag_name' <<<"$release")"
url="$(jq -r --arg a "$asset" '.assets[] | select(.name == $a) | .browser_download_url' <<<"$release")"
digest="$(jq -r --arg a "$asset" '.assets[] | select(.name == $a) | .digest // empty' <<<"$release")"
[[ -n "$url" ]] || { echo "neovim: release $tag has no $asset" >&2; exit 1; }
[[ "$digest" == sha256:* ]] || { echo "neovim: release $tag publishes no SHA-256 for $asset" >&2; exit 1; }

if $update && [[ -x "$OPT_DIR/bin/nvim" ]] && "$OPT_DIR/bin/nvim" --version | head -1 | grep -qF "NVIM $tag"; then
  echo "neovim: already the latest release ($tag)"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "neovim: downloading $tag ($asset)"
curl -fsSL -o "$tmp/$asset" "$url"
echo "${digest#sha256:}  $tmp/$asset" | sha256sum --check --quiet ||
  { echo "neovim: checksum mismatch for $asset, not installing" >&2; exit 1; }

# The tarball holds one folder (nvim-linux-<arch>/{bin,lib,share}). Unpack next
# to the target and swap it in, so a failed unpack never leaves a broken nvim.
mkdir -p "$(dirname "$OPT_DIR")" "$BIN_DIR"
tar -C "$tmp" -xzf "$tmp/$asset"
rm -rf "$OPT_DIR.new"
mv "$tmp/nvim-linux-$arch" "$OPT_DIR.new"
rm -rf "$OPT_DIR"
mv "$OPT_DIR.new" "$OPT_DIR"
ln -sfn "$OPT_DIR/bin/nvim" "$BIN_DIR/nvim"

echo "neovim: installed $("$BIN_DIR/nvim" --version | head -1)"
