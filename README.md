# zaun-cli

_zaun_ (German for "fence", pronounced _tsown_): fence in your coding agents.

zaun turns a fresh Ubuntu or Debian machine (an isolated VM or a VPS) into a workspace for AI
coding agents such as Claude Code and Codex. One command installs the tools, merges a small
shared config into your own settings, and checks that everything works. The agents get full
rights inside a box that holds only what you put there, not your laptop's keys and files.

```
┌  zaun  doctor
│  Environment
│  ✓ Ubuntu 24.04.1 LTS
│  ✓ Mac files not mounted  /mnt/mac, /Users
│  AI agents
│  ✓ Claude Code 2.1.289
│  ⚠ Codex CLI 0.160.0  not logged in
│    → run codex login (headless: codex login --device-auth)
└  24 ok · 1 warning · 0 failed
```

## Quick start

**1. Create an isolated machine.** On a Mac with [OrbStack](https://orbstack.dev):

```sh
orb create --isolated ubuntu:noble zaun
orb -m zaun
```

On a VPS, log in as a normal user with sudo (zaun refuses to run as root).
Details: [docs/setup.md](docs/setup.md#create-an-isolated-machine).

**2. Install** inside the machine:

```sh
curl -fsSL https://raw.githubusercontent.com/kossowski/zaun-cli/main/bootstrap.sh | bash
```

Pick modules in the menu, confirm the plan, done. Prefer to read first? Clone the repo to
`~/.zaun` and run `bootstrap.sh` from there ([manual install](docs/setup.md#manual)).

**3. Finish the setup.** zaun never logs in for you. The install prints the steps that apply:

```sh
exec zsh                        # switch to the new shell
claude                          # log in to Claude Code
codex login --device-auth       # log in to Codex
sudo tailscale up --ssh         # optional: join your tailnet
```

Log out and back in once so the `docker` group applies. Use a
[Nerd Font](https://www.nerdfonts.com) in your terminal for the prompt icons.

**4. Log in to GitHub** with a fine-grained token limited to the repos the agents should touch
(Contents and Pull requests: read and write):

```sh
read -rs GH_PAT && printf '%s' "$GH_PAT" | gh auth login --with-token && unset GH_PAT
gh auth setup-git
```

Step by step: [docs/github-token.md](docs/github-token.md).

**5. Check:**

```sh
zaun doctor
```

Every ⚠ and ✗ comes with a `→` hint to fix it.

## Usage

```sh
zaun install                                   # interactive menu
zaun install --only docker,gh --yes            # dependencies are added automatically
zaun install --all --yes --git-name "Your Name" --git-email you@example.com
zaun doctor [--all]                            # read-only health check
zaun --help
```

Bootstrap passes arguments through: `curl … | bash -s -- --all --yes …`.

## Modules

| Group               | Module id       | What you get                                                               |
| ------------------- | --------------- | -------------------------------------------------------------------------- |
| System              | `base`          | git, curl, jq, unzip, build-essential, ripgrep, fd                         |
|                     | `docker`        | Docker Engine + buildx + compose, you in the `docker` group                |
|                     | `tailscale`     | Tailscale, `tailscaled` running                                            |
|                     | `gh`            | GitHub CLI                                                                 |
| Shell               | `shell`         | zsh, [starship](https://starship.rs), autosuggestions, syntax highlighting |
|                     | `neovim`        | latest stable [Neovim](https://neovim.io), `EDITOR=nvim`                   |
| Runtimes            | `node`          | [fnm](https://github.com/Schniz/fnm) with Node LTS, pnpm via corepack      |
|                     | `python`        | [uv](https://docs.astral.sh/uv/) and a uv-managed Python                   |
| AI agents           | `claude-code`   | Claude Code                                                                |
|                     | `codex`         | Codex CLI                                                                  |
|                     | `herdr`         | [herdr](https://herdr.dev), a terminal workspace manager for agents        |
| Agent & tool config | `git-config`    | your git name/email plus a few defaults                                    |
|                     | `claude-config` | Claude Code status line + base `settings.json`, merged with yours          |
|                     | `codex-config`  | base `~/.codex/config.toml`, merged with yours                             |
|                     | `herdr-config`  | a starter herdr config (only if you don't have one)                        |
|                     | `skills`        | agent skills from your list (off by default)                               |

Each module that runs commands has a short, readable `modules/<id>/install.sh`.

## Your own settings

Personal settings (model, permissions, MCP servers, skills) go in a private overlay at
`~/.zaun-local/`, merged on top of zaun's base config on every `zaun install`:

```
~/.zaun-local/
├── claude/settings.json   merged into ~/.claude/settings.json
├── codex/config.toml      merged into ~/.codex/config.toml
└── skills.json            agent skills to install
```

Merge rules, examples and keeping the overlay in a private repo:
[docs/configuration.md](docs/configuration.md).

## More

- [Setup guide](docs/setup.md): machine creation, what bootstrap does, post-install details
- [GitHub token](docs/github-token.md): token permissions, rotation, commit signing
- [Configuration](docs/configuration.md): overlay merging and agent skills
- [Maintenance](docs/maintenance.md): health check, updating, uninstall, troubleshooting
- [Architecture](docs/architecture.md), [Contributing](CONTRIBUTING.md), [Security](SECURITY.md)

[MIT](LICENSE)
