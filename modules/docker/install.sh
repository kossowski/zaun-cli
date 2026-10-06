#!/usr/bin/env bash
# docker: Docker Engine from Docker's official apt repository.
#
# Usage:
#   bash modules/docker/install.sh          install / complete the setup (asks for sudo)
#   bash modules/docker/install.sh --list   print the package list and exit
#
# Follows https://docs.docker.com/engine/install/ubuntu/ and .../debian/ ("Install
# using the apt repository") plus the Linux post-install steps (docker group,
# start on boot). Docker has one repo per distro: linux/ubuntu for Ubuntu and its
# derivatives, linux/debian for Debian and the rest of the family.
#
# Safe to run any number of times: every step checks first and only acts when
# something is missing. An existing Docker that did NOT come from Docker's repo
# (the distro's docker.io, snap, Docker Desktop, rootless, ...) is left alone, so
# you never end up with two Dockers fighting over the same socket.
set -euo pipefail

# Single source of truth for the package list; modules/docker/index.ts reads it
# via `--list`.
PACKAGES=(
  docker-ce              # the daemon (dockerd)
  docker-ce-cli          # the `docker` command
  containerd.io          # the container runtime dockerd talks to
  docker-buildx-plugin   # `docker buildx` / BuildKit, the modern builder
  docker-compose-plugin  # `docker compose` (v2, a CLI plugin, not the old python docker-compose)
)

# The distro's own packages that overlap with the ones above. Docker's docs tell
# you to remove them first, otherwise apt runs into file conflicts. This is the
# union of the Ubuntu and Debian lists; only installed ones are removed.
CONFLICTING=(docker.io docker-doc docker-compose docker-compose-v2 docker-buildx podman-docker containerd runc)

if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${PACKAGES[@]}"
  exit 0
fi

is_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
me="$(id -un)"

# ---------------------------------------------------------------------------
# 1. Packages
# ---------------------------------------------------------------------------
if command -v docker >/dev/null && ! is_installed docker-ce-cli; then
  # A `docker` command exists, but not from Docker's repo. Respect it.
  echo "docker: found $(command -v docker) from another source (not docker-ce), leaving it as it is"
else
  missing=()
  for pkg in "${PACKAGES[@]}"; do
    is_installed "$pkg" || missing+=("$pkg")
  done

  if (( ${#missing[@]} == 0 )); then
    echo "docker: all packages already installed"
  else
    # 1a. Remove the overlapping distro packages (only those actually installed).
    remove=()
    for pkg in "${CONFLICTING[@]}"; do
      is_installed "$pkg" && remove+=("$pkg")
    done
    if (( ${#remove[@]} > 0 )); then
      echo "docker: removing conflicting packages ${remove[*]}"
      sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq "${remove[@]}"
    fi

    # 1b. Add Docker's apt repository, unless some file already points at it
    #     (a second entry with a different key path makes apt refuse to work:
    #     "Conflicting values set for option Signed-By").
    #     Either path (linux/ubuntu or linux/debian) counts.
    if grep -rqsE "download\.docker\.com/linux/(ubuntu|debian)" /etc/apt/sources.list /etc/apt/sources.list.d/; then
      echo "docker: apt repository already configured"
    else
      # Which of Docker's repos fits: Ubuntu and its derivatives (ID or ID_LIKE
      # contains ubuntu, e.g. Mint) use linux/ubuntu with the Ubuntu codename
      # (noble for 24.04); the rest of the Debian family uses linux/debian with
      # VERSION_CODENAME (bookworm, trixie, ...).
      read -r distro codename < <(
        # shellcheck source=/dev/null
        . /etc/os-release
        if [[ " ${ID:-} ${ID_LIKE:-} " == *" ubuntu "* ]]; then
          echo ubuntu "${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
        else
          echo debian "${VERSION_CODENAME:-}"
        fi
      )
      [[ -n "${codename:-}" ]] || { echo "docker: can't tell the release codename from /etc/os-release" >&2; exit 1; }
      repo_url="https://download.docker.com/linux/$distro"

      echo "docker: adding Docker's apt repository ($repo_url, $codename)"
      # The signing key goes to /etc/apt/keyrings and is referenced only by
      # this repo (Signed-By), so it can't vouch for packages from other repos.
      sudo install -m 0755 -d /etc/apt/keyrings
      sudo curl -fsSL "$repo_url/gpg" -o /etc/apt/keyrings/docker.asc
      sudo chmod a+r /etc/apt/keyrings/docker.asc

      # deb822 format (.sources), as in Docker's current docs. Suite = the
      # codename picked above; Architectures = arm64 or amd64.
      sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: ${repo_url}
Suites: ${codename}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    fi

    # 1c. Install whatever is missing. DEBIAN_FRONTEND keeps apt from asking questions.
    echo "docker: installing ${missing[*]}"
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Start dockerd now and on every boot (only where systemd is running;
#    containers and WSL without systemd have to start dockerd themselves).
# ---------------------------------------------------------------------------
if [[ -d /run/systemd/system ]] && systemctl cat docker.service >/dev/null 2>&1; then
  if systemctl is-enabled --quiet docker.service && systemctl is-active --quiet docker.service; then
    echo "docker: service already enabled and running"
  else
    echo "docker: enabling and starting the docker service"
    sudo systemctl enable --now containerd.service docker.service
  fi
elif [[ ! -d /run/systemd/system ]]; then
  echo "docker: no systemd here, so the daemon is not started automatically (start dockerd yourself)"
fi

# ---------------------------------------------------------------------------
# 3. Let the current user talk to the daemon without sudo.
#    Membership of the `docker` group is effectively root on this machine;
#    that is the deal on a dev VM. New group membership only applies to new
#    login sessions: log out and back in, or run `newgrp docker`.
# ---------------------------------------------------------------------------
if ! getent group docker >/dev/null; then
  echo "docker: there is no docker group (this Docker doesn't use one), skipping"
elif id -nG "$me" | tr ' ' '\n' | grep -qx docker; then
  echo "docker: $me is already in the docker group"
else
  echo "docker: adding $me to the docker group (log out and back in, or run \`newgrp docker\`)"
  sudo usermod -aG docker "$me"
fi
