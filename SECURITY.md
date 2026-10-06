# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private reporting instead: the repository's
**Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it and
which version (`zaun --version`) or commit you used. You'll get an answer as soon as possible;
this is a small volunteer project, so please allow a few days.

## What zaun does and doesn't do

zaun is an installer, and it's worth knowing what that implies:

- **It runs vendor installers.** Several modules download and run official install scripts over
  HTTPS (`curl … | sh`): Claude Code, Codex, herdr, Tailscale, starship, uv and fnm. Others add
  vendor apt repositories with their signing keys (Docker, GitHub CLI). zaun trusts these vendors
  and their TLS endpoints, as their own docs ask you to. Every one of these steps is visible in
  `modules/<id>/install.sh`.
- **It uses sudo** for apt, `chsh`, systemd services and the `docker` group, and asks for it once
  at the start. It refuses to run as root.
- **It never handles credentials.** zaun doesn't log in anywhere, doesn't read, store or transmit
  tokens, passwords or keys, and has no telemetry. Logins (`claude`, `codex login`,
  `gh auth login`, `tailscale up`) are always run by you. `zaun doctor` only checks whether you're
  logged in (e.g. that a credentials file exists, or `gh auth status` succeeds).
- **It backs up before replacing.** Files it changes are copied to
  `~/.zaun-local/backups/<timestamp>/` first.
- **The bootstrap one-liner** (`curl … | bash`) runs code from this repository's `main` branch. If
  you'd rather review it first, clone the repo and run `bootstrap.sh` from your checkout.

## Scope

In scope: zaun's own code and scripts, and the config it ships in `config/`. Out of scope: bugs
in the tools zaun installs (report them to their vendors) and the isolation guarantees of
OrbStack or your VM provider.
