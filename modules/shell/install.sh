#!/usr/bin/env bash
# shell: zsh as your login shell, the starship prompt and two zsh plugins.
#
# The config files (~/.config/starship.toml, the zaun block in ~/.zshrc) are
# handled by zaun itself (modules/shell/index.ts), because they need backups.
# Safe to run any number of times.
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
USER="${USER:-$(id -un)}"

# 1. zsh and the plugins from the distro's own repositories. Installing zsh also
#    adds it to /etc/shells, which chsh requires. config/zsh/zaun.zsh loads the
#    plugins from /usr/share/<name>/<name>.zsh.
#    - zsh-autosuggestions: greyed-out completion from your history, → accepts it
#    - zsh-syntax-highlighting: colours commands while you type (red = not found)
missing=()
for pkg in zsh zsh-autosuggestions zsh-syntax-highlighting; do
  if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed"; then
    echo "shell: $pkg already installed"
  else
    missing+=("$pkg")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "shell: installing ${missing[*]}"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi

# 2. Login shell. `getent passwd` reads the real value (the 7th field), which
#    is what new terminals and SSH sessions use. $SHELL only reflects the
#    session you are in right now.
zsh_path="$(command -v zsh)"
current_shell="$(getent passwd "$USER" | cut -d: -f7)"
if [[ "${current_shell##*/}" == zsh ]]; then  # /bin/zsh or /usr/bin/zsh, both fine
  echo "shell: zsh is already your login shell"
else
  # `sudo chsh` instead of plain `chsh`: plain chsh asks for your password,
  # and zaun runs without a terminal to type it into.
  echo "shell: changing login shell from ${current_shell:-?} to $zsh_path"
  sudo chsh -s "$zsh_path" "$USER"
fi

# 3. starship (https://starship.rs). --bin-dir: into your home, so no sudo is needed.
if command -v starship >/dev/null 2>&1 || [[ -x "$BIN_DIR/starship" ]]; then
  echo "shell: starship already installed"
else
  echo "shell: installing starship into $BIN_DIR"
  mkdir -p "$BIN_DIR"
  curl -fsSL https://starship.rs/install.sh | sh -s -- --yes --bin-dir "$BIN_DIR"
fi
