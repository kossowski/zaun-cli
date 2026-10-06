#!/usr/bin/env bash
# zaun bootstrap: get the zaun CLI onto a fresh apt-based machine (Ubuntu or
# Debian, arm64 or amd64) and start it.
#
#   curl -fsSL https://raw.githubusercontent.com/REPLACE_ME/zaun/main/bootstrap.sh | bash
#
# Arguments are passed on to `zaun install`, e.g. `... | bash -s -- --only base --yes`.
#
# Environment overrides (mostly for testing):
#   ZAUN_REPO  git URL or local directory to install from  (default: the GitHub repo)
#   ZAUN_DIR   where zaun lives                             (default: ~/.zaun)
#   ZAUN_REF   branch or tag to check out                   (default: the repo's default branch)
set -euo pipefail

ZAUN_REPO="${ZAUN_REPO:-https://github.com/kossowski/zaun-cli.git}"
ZAUN_DIR="${ZAUN_DIR:-$HOME/.zaun}"
ZAUN_REF="${ZAUN_REF:-}"
FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"

export NPM_CONFIG_UPDATE_NOTIFIER=false

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# Run a noisy command quietly; show its output only if it fails.
quietly() {
  local out
  out="$("$@" 2>&1)" || { printf '%s\n' "$out" >&2; return 1; }
}

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null
}

# Everything runs inside main(), called on the last line: if `curl | bash` is
# cut off halfway, bash never executes a partial script.
main() {
  # --- 1. Preconditions ------------------------------------------------------
  [[ -r /etc/os-release ]] && . /etc/os-release
  # Debian family = ID or ID_LIKE mentions debian (Ubuntu has ID_LIKE=debian).
  [[ " ${ID:-} ${ID_LIKE:-} " == *" debian "* ]] ||
    die "zaun needs an apt-based system (Ubuntu or Debian). This looks like '${PRETTY_NAME:-unknown}'."
  [[ "$(id -u)" -ne 0 ]] || die "Run this as a normal user with sudo rights, not as root."

  say "Checking sudo (you may be asked for your password)"
  # `sudo -n true` first: with NOPASSWD plus a regular rule (OrbStack's default),
  # `sudo -v` still prompts, because -v needs every matching rule to be NOPASSWD.
  sudo -n true 2>/dev/null || sudo -v || die "sudo is required."

  # --- 2. Minimal system packages -------------------------------------------
  local pkgs=(git curl ca-certificates unzip) missing=()
  for pkg in "${pkgs[@]}"; do
    dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q "install ok installed" || missing+=("$pkg")
  done
  if (( ${#missing[@]} > 0 )); then
    say "Installing ${missing[*]}"
    quietly sudo apt-get update -qq || die 'apt-get update failed.'
    quietly sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}" ||
      die 'apt-get install failed.'
  fi

  # --- 3. Get zaun -------------------------------------------------------------
  # zaun's repo is public: git must never ask for a username/password here. A
  # missing or private repo would otherwise prompt (GitHub answers both the same).
  export GIT_TERMINAL_PROMPT=0
  if [[ -d "$ZAUN_REPO" ]]; then
    # A local directory (development/testing): copy the working tree as it is,
    # including uncommitted changes. node_modules is rebuilt below.
    say "Copying zaun from $ZAUN_REPO"
    mkdir -p "$ZAUN_DIR"
    tar -C "$ZAUN_REPO" --exclude=./node_modules --exclude=./.git -cf - . | tar -C "$ZAUN_DIR" -xf -
  elif [[ -d "$ZAUN_DIR/.git" ]]; then
    say "Updating $ZAUN_DIR"
    git -C "$ZAUN_DIR" fetch --quiet --tags origin || die "Could not fetch updates for $ZAUN_DIR."
    [[ -z "$ZAUN_REF" ]] || git -C "$ZAUN_DIR" checkout --quiet "$ZAUN_REF"
    # A tag is a detached HEAD: nothing to pull. A branch fast-forwards.
    if git -C "$ZAUN_DIR" symbolic-ref -q HEAD >/dev/null; then
      git -C "$ZAUN_DIR" pull --quiet --ff-only ||
        die "Could not update $ZAUN_DIR (local changes?). Fix it or remove the folder."
    fi
  elif [[ -e "$ZAUN_DIR" ]]; then
    die "$ZAUN_DIR exists but is not a git checkout. Move it away or set ZAUN_DIR."
  else
    say "Cloning $ZAUN_REPO into $ZAUN_DIR"
    git clone --quiet ${ZAUN_REF:+--branch "$ZAUN_REF"} "$ZAUN_REPO" "$ZAUN_DIR" ||
      die "Could not clone $ZAUN_REPO. Check the URL, or set ZAUN_REPO to a local copy."
  fi
  unset GIT_TERMINAL_PROMPT

  # --- 4. Node.js ----------------------------------------------------------------
  # zaun is TypeScript run directly by Node (>= 22.18 strips types natively).
  if ! node_ok && [[ -x "$FNM_DIR/fnm" ]]; then
    export PATH="$FNM_DIR:$PATH"
    eval "$(fnm env --shell bash)"
  fi
  if ! node_ok; then
    if [[ ! -x "$FNM_DIR/fnm" ]]; then
      say "Installing fnm (Node version manager) into $FNM_DIR"
      # Official installer; --skip-shell: the `node` module sets up your shell later.
      quietly bash -c "curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir '$FNM_DIR' --skip-shell" ||
        die 'Installing fnm failed.'
    fi
    export PATH="$FNM_DIR:$PATH"
    say "Installing Node.js LTS"
    quietly fnm install --lts || die 'Installing Node.js failed.'
    quietly fnm default lts-latest
    eval "$(fnm env --shell bash)"
    node_ok || die "Node.js setup failed."
  fi

  # --- 5. Dependencies and the `zaun` command -----------------------------------
  say "Installing zaun's dependencies"
  quietly npm ci --prefix "$ZAUN_DIR" --omit=dev --no-audit --no-fund || die "npm ci failed in $ZAUN_DIR."

  local zaun="$HOME/.local/bin/zaun"
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$ZAUN_DIR/bin/zaun" "$zaun"
  say "zaun $("$zaun" --version) is ready: $zaun"
  # The stock ~/.profile adds ~/.local/bin to PATH only if it existed at login.
  # On a fresh machine it didn't, so `zaun` is found in new terminals only.
  # We call it by its full path and deliberately don't touch PATH here, so that
  # `zaun install` can tell and remind you at the end.
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) say "$HOME/.local/bin is not on your PATH yet: open a new terminal after the install to use \`zaun\`." ;;
  esac

  # --- 6. Hand over --------------------------------------------------------------
  # Under `curl | bash`, stdin is the script itself; the prompts need the terminal.
  if { : </dev/tty; } 2>/dev/null; then
    exec "$zaun" install "$@" </dev/tty
  else
    exec "$zaun" install "$@"
  fi
}

main "$@"
