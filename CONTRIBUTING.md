# Contributing to zaun

Thanks for helping. zaun is small on purpose: a module system, a health check, and readable
install scripts. Changes that keep it that way are the easiest to merge.

## Setup

```sh
git clone https://github.com/kossowski/zaun-cli.git
cd zaun
npm ci
npm run typecheck
npm test
```

Node ≥ 22.18 runs the TypeScript directly (type stripping), so there is no build step. Read
[docs/architecture.md](docs/architecture.md) first: it describes the module contract, the
Context API, the config strategies (symlink, merge, seed, managed block) and the TypeScript rules
(erasable syntax only, `.ts` import extensions).

**Never test installs on your own machine.** `zaun install` and the `install.sh` scripts change
your shell, your agents' config and system packages. Use the Docker script below.
`zaun doctor`, `--help`, typecheck and tests are read-only and safe anywhere.

## Adding a module

1. Create `modules/<id>/index.ts` (copy `modules/base/index.ts`, the reference module) and, if
   the module runs commands, `modules/<id>/install.sh`.
2. Add it to `src/core/registry.ts` (the list order is the menu order).
3. `npm run typecheck && npm test` (a test checks the dependency graph for cycles).
4. Try it in a throwaway container (see below), including a second run.
5. Mention it in the module table in `README.md`, plus any "after install" step it needs in `docs/setup.md`.

### `install.sh` is tutorial material

People read these scripts to learn how a tool is set up. Keep them:

- `#!/usr/bin/env bash` + `set -euo pipefail`, runnable on their own (`bash modules/<id>/install.sh`);
- **idempotent**: check first, skip what's already there, and print what was done or skipped;
- commented with the _why_, not the _what_; link the official install docs;
- using official installers / apt repos, with `sudo` only for the parts that need root;
- arch-aware (`dpkg --print-architecture` / `uname -m`): arm64 is primary, amd64 must work;
- non-interactive: stdin is closed during `zaun install`, so a prompting installer fails.

Data handling (merging JSON/TOML, symlinks with backups, state) belongs in `index.ts`, using
the helpers from `src/core/kit.ts`. `check()` must be read-only: no installs, writes or logins.

## Testing in Docker

`scripts/test-in-docker.sh` starts a fresh container (`ubuntu:24.04` unless you pass
`--image <image>` or set `ZAUN_TEST_IMAGE`) with a normal user `dev` (passwordless sudo), copies
your working tree in via `bootstrap.sh` (uncommitted changes included), installs, runs
`zaun doctor`, and removes the container afterwards.

```sh
scripts/test-in-docker.sh --only <id>                 # bootstrap + install + doctor
scripts/test-in-docker.sh --only <id> --twice         # idempotency: the 2nd run must change nothing
scripts/test-in-docker.sh --only <id> --shell         # ...then look around in a shell
scripts/test-in-docker.sh --all --exec "zsh -i -c 'node -v'"   # run a command as `dev` afterwards
scripts/test-in-docker.sh --only git-config --git-name 'Test User' --git-email test@example.com
scripts/test-in-docker.sh --interactive               # the real menu
scripts/test-in-docker.sh --only <id> --image debian:12   # on Debian instead of Ubuntu
```

There is no systemd in a container, so `dockerd` and `tailscaled` can't run there; their checks
fail in the container. Say in your PR what you couldn't test.

## Before you open a pull request

```sh
npm run typecheck
npm test
shellcheck --severity=warning bootstrap.sh bin/zaun scripts/*.sh modules/*/install.sh config/claude/statusline.sh
```

No shellcheck installed? `docker run --rm -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:stable --severity=warning <files>`.

CI runs the same, plus an end-to-end job that runs `bootstrap.sh --yes` on fresh
`ubuntu-24.04` and `ubuntu-24.04-arm` runners (amd64 and arm64) and then `zaun doctor`.
zaun targets any apt-based system (Ubuntu, Debian), but Ubuntu 24.04 is what CI tests: if your
change touches distro-specific behaviour, also try it with `--image debian:12` (or similar).

## Secret scanning

zaun is public. Never commit tokens, emails, personal paths or your own agent settings: those
belong in your private overlay (`~/.zaun-local`). CI scans every push and pull request with
[gitleaks](https://github.com/gitleaks/gitleaks). To catch leaks before they're committed, enable
the optional pre-commit hook:

```sh
pipx install pre-commit      # or: uv tool install pre-commit
pre-commit install           # runs gitleaks on staged changes before each commit
pre-commit run --all-files   # scan everything once
```

The hook in `.pre-commit-config.yaml` builds gitleaks with Go; without Go, switch the hook id to
`gitleaks-docker` or `gitleaks-system`.

## Style

- TypeScript: strict, erasable syntax only, small functions, comments that explain decisions.
- User-facing text: short and concrete. Hints name the command to run, in backticks.
- No new runtime dependencies without a good reason.
