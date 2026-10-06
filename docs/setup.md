# Setup guide

The full walkthrough behind the [README](../README.md) quick start: creating the isolated machine,
what the installer does, and the steps after the install.

## Create an isolated machine

### On a Mac: OrbStack

[OrbStack](https://orbstack.dev) runs lightweight Linux machines on macOS. By default an OrbStack
machine is tightly integrated with your Mac: your home folder is mounted at `/Users/…` and
`/mnt/mac`, and the `mac` command runs programs **on your Mac**. For agents, that defeats the
purpose. OrbStack's [isolated machines](https://docs.orbstack.dev/machines/isolated) turn all of
that off.

**With the CLI** (on your Mac):

```sh
orb create --isolated ubuntu:noble zaun
```

`ubuntu:noble` is Ubuntu 24.04 (any recent Ubuntu or Debian image works too, e.g.
`debian:bookworm`); `zaun` is the machine name (pick any). Add `--arch amd64` if you
need x86 (slower, emulated on Apple silicon), and `--cpus`, `--memory`, `--disk` to set limits.

**With the app:** _New Machine_ → Distribution _Ubuntu_ (or _Debian_), a recent version → turn on
**Isolate machine** → _Create_.

Already have a machine? `orb config set machine.<name>.isolated true`, then restart it
(`orb restart <name>`). Isolated machines also don't forward your Mac's SSH agent, which is what
you want: the agent's GitHub access comes from a scoped token instead ([GitHub token](github-token.md)).

Open a shell in the machine:

```sh
orb -m zaun          # or: ssh zaun@orb
```

You are logged in as a user named like your Mac user, with passwordless sudo. Check the isolation:

```sh
ls /mnt/mac /Users   # both: "No such file or directory"
timeout 3 mac true; echo $?   # non-zero: the mac command can't reach the host
```

`zaun doctor` runs these checks for you later ("Environment" section) and fails if the Mac is
reachable. A note from OrbStack's docs: isolation relies on the Linux kernel's security model.
It's a good fence for agents, not a sandbox for analysing malware.

### On a VPS

Any Ubuntu or Debian server (recent release) works, arm64 or x86_64. zaun refuses to run as root,
so create a normal user with sudo first (a minimal Debian may need `apt install sudo`):

```sh
# as root on the new server
adduser dev
usermod -aG sudo dev
# copy your SSH key so you can log in as dev
rsync --archive --chown=dev:dev ~/.ssh /home/dev
```

Then log in as that user (`ssh dev@your-server`). Server hardening (firewall, SSH config,
automatic updates) is out of scope for zaun for now. DigitalOcean's
[Initial Server Setup with Ubuntu](https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu)
is a good, short guide. Tailscale (below) lets you close the SSH port to the internet entirely.

## Install

### Curl

Inside the machine:

```sh
curl -fsSL https://raw.githubusercontent.com/kossowski/zaun-cli/main/bootstrap.sh | bash
```

### Manual

Prefer to read before you run? Same result:

```sh
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/kossowski/zaun-cli.git ~/.zaun
less ~/.zaun/bootstrap.sh          # read it
~/.zaun/bootstrap.sh
```

### What bootstrap.sh does

1. Checks that this is an apt-based system (Ubuntu, Debian or a relative) and that you are not
   root, then asks for your sudo password once.
2. Installs `git curl ca-certificates unzip` with apt, only the ones that are missing.
3. Clones zaun into `~/.zaun` (or updates it with `git pull --ff-only` if it's already there).
4. Installs [fnm](https://github.com/Schniz/fnm) and the current Node LTS into
   `~/.local/share/fnm`, unless Node ≥ 22.18 is already there. zaun is TypeScript that Node runs
   directly, without a build step.
5. Runs `npm ci --omit=dev` in `~/.zaun` and links `~/.local/bin/zaun`.
6. Starts `zaun install`, passing on any arguments you gave.

### The menu

`zaun install` then asks, in this order:

1. **Which modules?** A grouped checklist. On the first run everything except `skills` is
   preselected; later runs preselect your last choice. Installed modules are marked `✓ installed`
   and skipped.
2. **Private overlay?** (only if you picked `claude-config`, `codex-config` or `skills`):
   none, a local folder `~/.zaun-local`, or clone your private git repo into it.
   See [Configuration](configuration.md).
3. **Git name and email** (if you picked `git-config`), prefilled from your existing git config.
4. **The plan**: what will be installed, in which order, what needs sudo. Confirm, and zaun
   works through the modules with a spinner each, then runs the health check and lists your
   next steps.

A failing module doesn't stop the run: modules that depend on it are skipped, the rest continue,
and the summary points you to the log file.

### Without prompts

```sh
zaun install --only docker,gh --yes        # base is added automatically
zaun install --all --yes --git-name "Your Name" --git-email you@example.com
zaun install --yes                         # last selection (or the defaults)
```

The same works through bootstrap, e.g. for provisioning scripts:

```sh
curl -fsSL https://raw.githubusercontent.com/kossowski/zaun-cli/main/bootstrap.sh \
  | bash -s -- --all --yes --git-name "Your Name" --git-email you@example.com
```

`zaun --help` lists all options and module ids.

## After the install

These steps need you. `zaun install` prints the ones that apply under **Next steps**, and
`zaun doctor` keeps warning (⚠) until they're done.

### Start zsh

```sh
exec zsh
```

New terminals and SSH sessions use zsh automatically (it's your login shell now).
As you type, a greyed-out suggestion from your history appears: `→` (or `End`) accepts it.
Commands turn green when they exist and red when they don't.

### Use a Nerd Font in your terminal

The starship prompt and the Claude Code status line use [Nerd Font](https://www.nerdfonts.com)
symbols (branch icon, language icons). Fonts are a setting of the terminal **on your Mac/PC**,
not of the VM. Good choices: _JetBrainsMono Nerd Font_, _FiraCode Nerd Font_, _Hack Nerd Font_.

```sh
# on your Mac
brew install --cask font-jetbrains-mono-nerd-font
```

- **Ghostty**: ships the Nerd Font symbols built in, nothing to do. To change the font anyway:
  `font-family = "JetBrainsMono Nerd Font"` in `~/.config/ghostty/config`.
- **iTerm2**: Settings → Profiles → Text → Font.
- **Terminal.app**: Settings → Profiles → Text → Font → Change….
- **VS Code terminal**: `"terminal.integrated.fontFamily": "JetBrainsMono Nerd Font"`.

Empty boxes or question marks in the prompt mean the font is missing.

### Log in to the agents

**Claude Code:**

```sh
claude
```

Follow the login prompts. In a VM without a browser, Claude Code shows a URL: open it on your
Mac, sign in, and paste the code back into the terminal. (Using an API key instead? Set
`ANTHROPIC_API_KEY` in your environment.)

**Codex:**

```sh
codex login --device-auth
```

Open the link on any device, sign in and enter the one-time code. Device-code sign-in is opt-in:
if it's refused, turn on _Enable device code sign-in for Codex_ in ChatGPT under
Settings → Security (workspace accounts: your admin controls this). `codex login status` shows
whether it worked.

### Docker without sudo

zaun adds you to the `docker` group. Group changes apply to new login sessions only:

```sh
exit                 # then reconnect (orb -m zaun / ssh)
docker run --rm hello-world
```

(`newgrp docker` works for the current shell too.) Note that `docker` group membership is
effectively root on this machine. That's the usual trade-off on a dev box.

### Tailscale

[Tailscale](https://tailscale.com) puts the machine on your private network (your _tailnet_), so
you can reach it from your laptop, tablet or phone without opening ports.

```sh
sudo tailscale up          # prints a login URL
sudo tailscale up --ssh    # ...and let Tailscale handle SSH (access controlled in the admin console)
```

With [MagicDNS](https://tailscale.com/kb/1081/magicdns) (on by default) the machine is reachable
by its name: `ssh dev@zaun`, or `http://zaun:3000` for a dev server. `tailscale status` shows
your devices. On a VPS you can then close port 22 to the internet.

### herdr basics

[herdr](https://herdr.dev) keeps your agents running in panes and tabs, and they keep running when
you disconnect.

```sh
herdr                # start or re-attach to your session
claude               # in a pane: herdr detects the agent
```

The prefix key is `Ctrl+B` (like tmux): `prefix v` split right, `prefix -` split down,
`prefix c` new tab, `prefix q` detach. It's mouse-friendly too. zaun's starter config uses zsh
as the shell and system notifications. Docs: [quick start](https://herdr.dev/docs/quick-start/),
[configuration](https://herdr.dev/docs/configuration/).
