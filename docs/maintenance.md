# Maintenance

## Health check

```sh
zaun doctor          # the modules you selected (plus their dependencies)
zaun doctor --all    # every module
```

`zaun doctor` only reads: no installs, no writes, no logins. Sample output:

```
│  Environment
│  ✓ Ubuntu 24.04.1 LTS
│  ✓ Architecture arm64
│  ✓ User dev  not root
│  ✓ Mac files not mounted  /mnt/mac, /Users
│  ✓ mac command cannot reach the host
│
│  System
│  ✓ Base packages  git 2.43.0 · ripgrep 14.1.0
│  ⚠ Docker 29.1.2  you're in the docker group, but this session isn't yet
│    → log out and back in, or run newgrp docker
│  ✓ Docker Compose  2.40.3
│  ⚠ Tailscale 1.90.6  not logged in (NeedsLogin)
│    → run sudo tailscale up (add --ssh for Tailscale SSH)
│  ✓ gh 2.83.0
│  ✓ gh logged in  you (keyring)
│
│  Agent & tool config
│  ✗ Claude statusline  ~/.claude/statusline.sh missing
│    → run zaun install --only claude-config
└  21 ok · 2 warnings · 1 failed
```

| Symbol | Meaning                                                                       |
| ------ | ----------------------------------------------------------------------------- |
| ✓      | OK                                                                            |
| ⚠      | installed, but needs you: log in, re-login for a group, a config that drifted |
| ✗      | missing or broken. `zaun doctor` exits with status 1 if anything failed       |

Each ⚠ and ✗ comes with a `→` hint: usually one command to run.

## Updating

Honest scope: zaun **installs and checks**. It doesn't update tools behind your back.

**zaun itself:** re-run bootstrap (it pulls `~/.zaun` and reinstalls dependencies), or by hand:

```sh
git -C ~/.zaun pull --ff-only && npm ci --prefix ~/.zaun --omit=dev
zaun install         # re-applies config changes (merges, links); installed tools are skipped
```

Symlinked config (`starship.toml`, the Claude status line, `zaun.zsh`) changes as soon as you
pull; merged files (`settings.json`, `config.toml`) need the `zaun install`.

**The tools** update themselves or with their own commands:

| Tool                                | How                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| apt packages, Docker, gh, Tailscale | `sudo apt update && sudo apt upgrade`                                                                              |
| Claude Code                         | updates itself in the background (`claude update` to force)                                                        |
| Codex                               | offers updates on start; or re-run the official installer: `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` |
| herdr                               | `herdr update`                                                                                                     |
| Node                                | `fnm install --lts && fnm default lts-latest`                                                                      |
| uv / Python                         | `uv self update`, `uv python install <version>`                                                                    |
| Neovim                              | `bash ~/.zaun/modules/neovim/install.sh --update`                                                                  |
| starship                            | re-run the [installer](https://starship.rs) with `--bin-dir ~/.local/bin`                                          |

## Uninstall and reset

The cleanest reset is a new machine: on a Mac, `orb delete zaun` and
[start over](setup.md#create-an-isolated-machine). That's the point of a fenced-off box.

To remove zaun from a machine you keep, here's everything it created:

| What                          | Where                                                | Undo                                                                                    |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| zaun itself                   | `~/.zaun`, `~/.local/bin/zaun`                       | `rm -rf ~/.zaun ~/.local/bin/zaun`                                                      |
| state, logs, backups, overlay | `~/.zaun-local/`                                     | keep `backups/` until you're sure, then `rm -rf ~/.zaun-local`                          |
| zsh block                     | `# >>> zaun >>>` … `# <<< zaun <<<` in `~/.zshrc`    | delete those lines                                                                      |
| symlinks                      | `~/.config/starship.toml`, `~/.claude/statusline.sh` | `rm` them (restore from `backups/` if you had your own)                                 |
| merged files                  | `~/.claude/settings.json`, `~/.codex/config.toml`    | real files; restore the pre-zaun copy from `~/.zaun-local/backups/<timestamp>/` or edit |
| seeded file                   | `~/.config/herdr/config.toml`                        | yours now; delete if you like                                                           |
| git defaults                  | `~/.gitconfig`                                       | `git config --global --unset <key>`                                                     |

Backups mirror the path below your home folder, e.g.
`~/.zaun-local/backups/2026-10-05_16-30-12/.claude/settings.json`.

The tools zaun installed are ordinary installs and are removed the usual way (`apt remove`,
`chsh -s /bin/bash`, deleting `~/.local/share/fnm`, `~/.local/opt/nvim`, `~/.local/bin/{claude,codex,herdr,nvim,starship,uv}`, …).
zaun has no uninstall command.

## Troubleshooting

**Where's the log?** Every install writes `~/.zaun-local/logs/install-<timestamp>.log` with the
full output of every command. The last lines of a failure are also printed on screen.

**`zaun: command not found`.** `~/.local/bin` isn't on your PATH yet: `exec zsh`, or
`export PATH="$HOME/.local/bin:$PATH"`.

**`zaun: Node.js >= 22.18 not found`.** Re-run bootstrap; it installs Node via fnm.

**`Could not get lock /var/lib/dpkg/lock-frontend`.** A fresh VPS often runs unattended upgrades
right after boot. Wait a few minutes and run `zaun install` again: it continues where it stopped.

**Docker: `permission denied … docker.sock`.** Log out and back in ([Docker without sudo](setup.md#docker-without-sudo)).

**`zaun doctor` warns "Mac files are visible" / "`mac` command reaches the host".** The OrbStack
machine isn't isolated: `orb config set machine.<name>.isolated true` and restart it, or create a
new one with `--isolated`.

**"Claude settings differs in: …" / "Codex config differs in: …".** The tool or you changed a key
that zaun's base or your overlay sets. `zaun install --only claude-config,codex-config --yes`
applies the merge again (with a backup); or move your preferred value into the overlay.

**"Could not parse ~/.claude/settings.json".** The file (or your overlay) isn't valid JSON. Fix it;
zaun won't overwrite a file it can't read.

**Cloning the overlay asks for a password / fails.** Use an HTTPS URL after the [GitHub token](github-token.md) login (`gh auth setup-git`).

**`codex login --device-auth` is refused.** Enable device code sign-in in ChatGPT's security
settings (see [Log in to the agents](setup.md#log-in-to-the-agents)).

**nvm warning.** zaun manages Node with fnm and never deletes `~/.nvm`; remove the nvm lines from
`~/.zshrc` so they don't shadow fnm's Node.

Something else? Open an issue with the output of `zaun doctor --all` and the relevant part of the
log (check it for anything private first).
