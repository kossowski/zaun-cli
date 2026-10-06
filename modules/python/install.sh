#!/usr/bin/env bash
# python: uv and a uv-managed Python.
#
# Why uv: one fast tool for Python versions, virtualenvs, packages and
# command-line tools (`uv tool install ...`), installed per user without sudo.
# The Python it installs is separate from the system python3, so
# upgrading it can never break apt or other system tools.
# Safe to run any number of times.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# 1. uv, with the official installer. It installs into ~/.local/bin.
#    UV_NO_MODIFY_PATH=1: don't edit ~/.zshrc / ~/.bashrc / ~/.profile;
#    zaun's zsh config already puts ~/.local/bin on the PATH.
if command -v uv >/dev/null 2>&1; then
  echo "python: uv already installed ($(uv --version))"
else
  echo "python: installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh
fi

# 2. The latest stable Python. Without a version, `uv python install` picks
#    the newest release and does nothing if it's already there. It also puts a
#    versioned command (e.g. `python3.14`) into ~/.local/bin; inside projects
#    use `uv run python` / `uv venv`.
#    `cd /`: uv honours a .python-version file in the current directory (and
#    its parents), which would make this install that version instead.
#    --managed-python: only count Pythons uv installed, not the system python3.
cd /
if uv python find --managed-python >/dev/null 2>&1; then
  echo "python: a uv-managed Python is already installed ($(uv python find --managed-python))"
else
  echo "python: installing the latest Python with uv"
  uv python install
fi
