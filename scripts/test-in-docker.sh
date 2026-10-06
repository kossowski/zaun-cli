#!/usr/bin/env bash
# Try zaun in a throwaway container instead of your own machine.
#
#   scripts/test-in-docker.sh --only base            bootstrap + install base + doctor
#   scripts/test-in-docker.sh --only node,python     deps are added automatically
#   scripts/test-in-docker.sh --all                  every module
#   scripts/test-in-docker.sh --interactive          the real interactive installer (needs a terminal)
#   scripts/test-in-docker.sh --only base --twice    install twice (the 2nd run must be a no-op)
#   scripts/test-in-docker.sh --only base --shell    ...then drop into a shell in the container
#   scripts/test-in-docker.sh --all --exec "zsh -i -c 'node -v'"
#                                                    run a command as the test user afterwards
#   scripts/test-in-docker.sh --only base --image debian:12
#                                                    another base image (any apt-based one)
#
# The base image defaults to ubuntu:24.04 (what CI tests); --image or the
# ZAUN_TEST_IMAGE environment variable picks another, e.g. debian:13 or ubuntu:22.04.
#
# Other `zaun install` flags are passed through, e.g. --git-name 'Test User' --git-email test@example.com.
#
# The repo is mounted read-only and copied to ~/.zaun inside the container by
# bootstrap.sh (ZAUN_REPO=<local dir>), so uncommitted changes are tested too.
# The container and its volume are removed afterwards (--rm).
#
# Limits: there's no systemd in a container, so daemons (dockerd, tailscaled)
# can't run; their checks are expected to fail here.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

zaun_args=()
only_ids=""
all=false
interactive=false
shell=false
twice=false
exec_cmd=""
image="${ZAUN_TEST_IMAGE:-ubuntu:24.04}"
while (( $# > 0 )); do
  case "$1" in
    --only) zaun_args+=(--only "$2"); only_ids="$2"; shift 2 ;;
    --only=*) zaun_args+=("$1"); only_ids="${1#--only=}"; shift ;;
    --all) zaun_args+=(--all); all=true; shift ;;
    --interactive|-i) interactive=true; shift ;;
    --shell) shell=true; shift ;;
    --twice) twice=true; shift ;;
    --exec) exec_cmd="$2"; shift 2 ;;
    --exec=*) exec_cmd="${1#--exec=}"; shift ;;
    --image) image="$2"; shift 2 ;;
    --image=*) image="${1#--image=}"; shift ;;
    --git-name|--git-email) zaun_args+=("$1" "$2"); shift 2 ;;
    --git-name=*|--git-email=*) zaun_args+=("$1"); shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
if $interactive; then
  [[ -t 0 && -t 1 ]] || { echo "--interactive needs a terminal." >&2; exit 2; }
else
  [[ -n "$only_ids" ]] || $all || { echo "Pass --only <ids>, --all or --interactive." >&2; exit 2; }
  zaun_args+=(--yes)
fi

# --- What runs as the normal user `dev` inside the container --------------------
quoted_args=""
(( ${#zaun_args[@]} == 0 )) || quoted_args="$(printf '%q ' "${zaun_args[@]}")"
user_script="export LANG=en_US.UTF-8
status=0
ZAUN_REPO=/src bash /src/bootstrap.sh $quoted_args|| status=\$?"
if $twice; then
  user_script+="
echo; echo '===== second run: zaun install again (should skip everything) ====='
~/.local/bin/zaun install $quoted_args|| status=\$?"
  # ...and each selected module's install.sh directly, which zaun skipped: it must be a no-op too.
  if $all; then
    ids_expr='$(ls ~/.zaun/modules)'
  else
    ids_expr="$(tr ',' ' ' <<<"$only_ids")"
  fi
  user_script+="
for id in $ids_expr; do
  [ -f ~/.zaun/modules/\$id/install.sh ] || continue
  echo; echo \"===== bash modules/\$id/install.sh (directly, again) =====\"
  bash ~/.zaun/modules/\$id/install.sh || status=\$?
done"
fi
user_script+="
echo
~/.local/bin/zaun doctor || true"
if [[ -n "$exec_cmd" ]]; then
  # A fresh login shell (runuser -l), so this sees what a new terminal would see.
  user_script+="
echo; echo $(printf '%q' "===== exec: $exec_cmd =====")
runuser_cmd=$(printf '%q' "$exec_cmd")
sudo -n runuser -l dev -c \"\$runuser_cmd\" || status=\$?"
fi
if $shell; then
  user_script+="
echo; echo \"install exit status: \${status}. Exit this shell to throw the container away.\"
exec bash -l"
else
  user_script+="
exit \${status}"
fi

# --- What runs as root first: a normal user `dev` with passwordless sudo, like a fresh VPS
root_script="set -e
apt-get update -qq && apt-get install -y -qq sudo locales >/dev/null 2>&1
locale-gen en_US.UTF-8 >/dev/null
useradd -m -s /bin/bash dev && echo 'dev ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/dev
exec runuser -l dev -c $(printf '%q' "$user_script")"

# --- The container ----------------------------------------------------------------
# Why a chroot: on some Docker hosts (seen on OrbStack) the image's overlay
# filesystem makes dpkg fail with "Invalid cross-device link" when it renames
# files of packages that ship files under /bin or /lib (zsh, docker-ce, ...).
# So we copy the whole root filesystem into a single volume and chroot into it:
# every rename then stays on one filesystem. mount/chroot need SYS_ADMIN, and
# AppArmor's default Docker profile blocks the mounts. The anonymous volume is
# removed together with the container (--rm).
outer='set -e
mkdir -p /rootfs
tar -C / --one-file-system --exclude=./rootfs --exclude=./proc --exclude=./sys --exclude=./dev --exclude=./src -cf - . | tar -C /rootfs -xf -
mkdir -p /rootfs/proc /rootfs/sys /rootfs/dev /rootfs/src
mount -t proc proc /rootfs/proc
mount --rbind /dev /rootfs/dev
mount --rbind /sys /rootfs/sys
mount --bind /src /rootfs/src
cp /etc/resolv.conf /rootfs/etc/resolv.conf
exec chroot /rootfs bash -c "$ROOT_SCRIPT"'

tty_flags=(-i)
[[ -t 0 && -t 1 ]] && tty_flags=(-it)

# A unique name (per invocation) so parallel runs don't collide and a leftover
# container is easy to identify: `docker rm -f zaun-test-<pid>`.
exec docker run --rm "${tty_flags[@]}" --name "zaun-test-$$" \
  --cap-add SYS_ADMIN --security-opt apparmor=unconfined \
  --mount type=volume,dst=/rootfs \
  -e ROOT_SCRIPT="$root_script" \
  -v "$REPO_ROOT:/src:ro" \
  "$image" bash -c "$outer"
