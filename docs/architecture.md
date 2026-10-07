# Architecture

zaun is a small TypeScript CLI that Node runs directly (Node ≥ 22.18 strips
types natively, so there is no build step). It is organised around **modules**:
one folder per thing it can set up.

```
bootstrap.sh              curl | bash entry point: git, Node, npm ci, then `zaun install`
bin/zaun                  bash launcher: finds Node (PATH or fnm's default), runs src/cli.ts
src/cli.ts                argument parsing, dispatch to commands
src/commands/install.ts   menu → plan → sudo → run modules → health check → next steps
src/commands/doctor.ts    read-only checks, grouped report
src/core/types.ts         the module contract and the Context API
src/core/kit.ts           everything a module imports (one import path)
src/core/context.ts       command runner, log file, sudo keep-alive
src/core/files.ts         config strategies: symlink, merge, seed, managed block
src/core/merge.ts         deepMerge
src/core/order.ts         dependency resolution (auto-include deps, cycle detection)
src/core/registry.ts      the list of all modules (menu order)
src/core/state.ts         ~/.zaun-local/state.json
src/core/env.ts           OS (os-release)/arch/OrbStack/isolation detection
src/core/ui.ts            symbols, colors, formatting on top of @clack/prompts
modules/<id>/index.ts     module definition
modules/<id>/install.sh   the actual install steps, as plain bash (where it makes sense)
config/                   public config shipped to users
test/                     vitest unit tests for the pure logic
scripts/test-in-docker.sh try modules in a throwaway container (ubuntu:24.04 by default)
```

TypeScript rules (so Node can run the files as they are): erasable syntax only
(no `enum`, `namespace`, constructor parameter properties), relative imports
end in `.ts`, type-only imports use `import type` / `type` specifiers.

## The module contract

```ts
export default defineModule({
  id: 'gh',                      // fixed; also the folder name
  name: 'GitHub CLI',            // shown in menus and reports
  group: 'system',               // 'system' | 'shell' | 'runtimes' | 'agents' | 'config'
  description: '…',              // one line, menu hint
  deps: ['base'],                // installed first, auto-included when selected
  sudo: true,                    // install needs root → zaun primes sudo once up front
  defaultSelected: true,         // preselected on the first run

  async isInstalled(ctx) {},     // fast, read-only: "nothing to do" → module is skipped
  async install(ctx) {},         // idempotent
  async check(ctx) { return [] },// READ-ONLY health check → CheckResult[]
  async nextSteps(ctx) { return [] }, // optional: lines for the final summary (sync or async)
});
```

- **`isInstalled`** is used to mark modules as installed in the menu and to
  **skip** them during install. Return `true` only when running `install` again
  would change nothing. Config modules should therefore return `false` when the
  target is out of date (e.g. the merge result differs from the file).
- **`install`** must be idempotent and must not prompt (stdin is closed; a
  prompting installer fails instead of hanging). Throw on failure; zaun shows
  the error and the log path, skips modules that depend on this one, carries on
  with the rest and exits non-zero at the end.
- **`check`** must have no side effects: no installs, no writes, no logins.
  It runs in parallel with other checks. Return one or more results:

  ```ts
  { status: 'ok' | 'warn' | 'fail', label: 'gh 2.62.0', detail?: '…', hint?: 'run `gh auth login`' }
  ```

  `warn` means "installed, but the user has to do something" (log in, re-login,
  join a group). `fail` means broken or missing; `zaun doctor` exits 1 on any
  `fail`. Text in backticks is rendered as a command.
- **`nextSteps`** returns short sentences, e.g. ``'Run `gh auth login`'``, as
  `string[]` or `Promise<string[]>`. Check first (read-only, like `check`) and
  return only what is actually left to do: `codex` asks `codex login status`,
  `tailscale` reads `tailscale status --json`. Don't add "open a new terminal":
  `zaun install` ends with exactly one such line itself (``exec zsh`` when the
  `shell` module is part of the run), whenever something was installed or
  `~/.local/bin` wasn't on the PATH the install started with.

## Context API

Every method gets a `ctx` (see `src/core/types.ts`):

| Member | What it does |
|---|---|
| `ctx.run(cmd, { sudo?, cwd?, env?, timeoutMs? })` | `bash -c cmd`, output to the log file, returns trimmed stdout. Throws `RunError` with the last lines of output on a non-zero exit. `sudo: true` runs it via `sudo -n`. |
| `ctx.tryRun(cmd, opts?)` | Same but never throws: `{ ok, code, stdout, stderr }`. Use it in `check` / `isInstalled`. |
| `ctx.runScript(id, args?, opts?)` | Runs `modules/<id>/install.sh args…` as the current user. The script calls `sudo` itself where needed. |
| `ctx.exists(cmd)` | Is `cmd` on the PATH? |
| `ctx.addPath(dir)` | Prepend `dir` to PATH for this process and all later commands (after installing into a new bin dir). `~/.local/bin` is always added. |
| `ctx.progress(msg)` | Update the spinner text while installing. |
| `ctx.log.info(msg)` / `ctx.log.warn(msg)` | Log file only / log file + shown to the user after the module finishes. |
| `ctx.paths` | `home`, `zaunDir` (repo root), `configDir` (`<zaunDir>/config`), `localDir` (`~/.zaun-local`), `backupDir` (this run's backups), `logFile` (null in doctor). |
| `ctx.env` | `arch` (`arm64`/`amd64`), `machine` (`uname -m`), `os` (from `/etc/os-release`: `id`, `versionId`, `prettyName`, `debianFamily` = ID or ID_LIKE contains `debian`), `user`, `isRoot`, `isOrbStack`, `isIsolated`. |
| `ctx.options` | `gitName`, `gitEmail` (`--git-name`/`--git-email`, prompted, or from state), `nonInteractive`. |

Scripts started by `run`/`runScript` get `ZAUN_DIR`, `ZAUN_LOCAL_DIR` and
`DEBIAN_FRONTEND=noninteractive` in their environment.

## install.sh vs. TypeScript

Put "run these commands" logic (apt repos, official installers, `chsh`) in
`modules/<id>/install.sh`. These scripts are tutorial material too:

- `#!/usr/bin/env bash` + `set -euo pipefail`
- runnable on their own: `bash modules/gh/install.sh`
- idempotent: check first, skip what's already there, print what you did
- comments explain *why*, not *what*
- use `sudo` for the root parts; never assume the script itself runs as root
- `dpkg --print-architecture` / `uname -m` for arm64 vs amd64

Put data handling (merging JSON/TOML, symlinks with backups, reading
overlays, state) in `index.ts` using the helpers below. `modules/base` is the
reference for the split: `install.sh` installs and also prints its package
list (`--list`), which `index.ts` uses for a read-only `check`.

## Config strategies

All helpers are exported from `src/core/kit.ts`, take `ctx` first, and return
`'created' | 'updated' | 'unchanged'`. Whatever they replace is backed up to
`~/.zaun-local/backups/<timestamp>/` (mirroring the path below `$HOME`).

| Strategy | Helper | Use when |
|---|---|---|
| **symlink** | `symlinkWithBackup(ctx, source, target)` | zaun owns the file completely and the tool never writes to it (starship.toml, statusline.sh). Edits in the repo apply immediately. |
| **merge** | `mergeJsonFile(ctx, target, { base, overlays })`, `mergeTomlFile(…)`; dry run: `mergeDrift(target, { base, overlays }, 'json' \| 'toml')` | The tool writes the file itself (Claude Code `settings.json`, Codex `config.toml`). Result = `deepMerge(existing, base, ...overlays)`: objects merge recursively, arrays concatenate without duplicates, scalars: later wins. Keys only the tool/user wrote survive. Always a real file, never a symlink. Missing overlays are skipped. TOML comments are not preserved. |
| **seed** | `seedFile(ctx, source, target)` | A starting point the user owns afterwards (herdr config). Copied only if missing. |
| **managed block** | `upsertManagedBlock(ctx, file, body, { name?, comment? })` | A few lines in a file the user also edits (`~/.zshrc`). Inserts or replaces `# >>> zaun >>>` … `# <<< zaun <<<`. Use a different `name` for a second block. |

`mergeDrift` is the read-only side of merge, for `isInstalled` and `check`:
it returns `{ exists, isSymlink, drift }`, where `drift` lists the top-level
keys the merge would add or change. Up to date = `exists && !isSymlink &&
drift.length === 0`. It throws (with the file name) on a parse error. Modules
import only from `kit.ts`, never from parser libraries directly.

Other helpers: `deepMerge(...layers)`, `upsertBlock(content, body, name?, comment?)`
(pure), `backupPath(ctx, path, { move? })`, `readJsonFile(path, fallback)`,
`writeFileAtomic(path, content)`, `shellQuote(s)`, `firstLine(text)`,
`tildify(path)`, `notImplementedCheck(label)`.

## Private overlay and state

`~/.zaun-local/` (never inside the repo) holds:

- `state.json`: selected modules, install timestamps, git identity (prompted or
  from `--git-name`/`--git-email`), overlay choice
- optional overlays: `claude/settings.json`, `codex/config.toml`
- `backups/<timestamp>/`, `logs/install-<timestamp>.log`

It can be a plain folder or a clone of the user's own private git repo (chosen
during `zaun install`; cloned only if the folder holds nothing but zaun's own
files, updated with `git pull --ff-only` on later runs).

## Adding a module

1. Create `modules/<id>/index.ts` (copy `modules/base/index.ts`) and, if it runs
   commands, `modules/<id>/install.sh`.
2. Import it in `src/core/registry.ts` and add it to the list (menu order).
3. `npm run typecheck && npm test` (a test asserts the registry has no cycles).
4. Try it in a container, never on your own machine:

   ```sh
   scripts/test-in-docker.sh --only <id>            # bootstrap + install + doctor
   scripts/test-in-docker.sh --only <id> --shell    # …and look around afterwards
   scripts/test-in-docker.sh --only <id> --twice    # idempotency: zaun again, then install.sh directly
   scripts/test-in-docker.sh --interactive          # the real menu
   scripts/test-in-docker.sh --all --git-name 'Test User' --git-email test@example.com \
     --exec "zsh -i -c 'node -v'"                   # …then a command as the user, in a fresh login shell
   ```

   The container is `ubuntu:24.04` (the release CI tests, amd64 and arm64)
   unless `--image debian:12` or `ZAUN_TEST_IMAGE` picks another apt-based
   image. It has a normal user `dev` (passwordless sudo); the repo is copied in
   by `bootstrap.sh` (`ZAUN_REPO=/src`), so uncommitted changes are tested.
   There is no systemd, so daemons (dockerd, tailscaled) can't run there: test
   what you can and say what you couldn't.

   The script copies the image's root filesystem into one Docker volume and
   chroots into it (needs `--cap-add SYS_ADMIN --security-opt
   apparmor=unconfined`). On some hosts (seen on OrbStack) dpkg otherwise
   fails with "Invalid cross-device link" for packages with files under
   `/bin` or `/lib` (zsh, docker-ce). Each run's container is named
   `zaun-test-<pid>` and removed with its volume afterwards.

## Non-interactive runs

`zaun install` prompts unless `--yes` is given. Without a terminal (stdin or
stdout not a TTY: provisioning scripts, CI, `ssh host zaun install`) and
without `--yes`, it exits with code 2 and says which flags to pass, instead
of hanging in a prompt. A fully unattended first run:

```sh
zaun install --all --yes --git-name "Your Name" --git-email you@example.com
```

## PATH on a fresh machine

Installers put binaries into `~/.local/bin`, but the stock `~/.profile` adds
that folder to PATH only if it existed at login. So:

- `bootstrap.sh` links `~/.local/bin/zaun` and starts it by its full path,
  without changing PATH, and says so if `~/.local/bin` isn't on PATH yet.
- `bin/zaun` finds Node on its own (PATH, else fnm's `aliases/default/bin`,
  else `fnm env`), so it works from any shell.
- During the install, `ctx` puts `~/.local/bin` (and e.g. fnm's Node) on PATH
  for later modules.
- At the end, `zaun install` tells you once to open a new terminal (or
  `exec zsh`); `config/zsh/zaun.zsh` puts `~/.local/bin` and fnm on PATH.
