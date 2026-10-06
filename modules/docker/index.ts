// docker: Docker Engine + buildx + compose from Docker's official apt repository.
//
// install.sh does the work (repo, packages, systemd service, `docker` group).
// An existing Docker from another source (the distro's docker.io, snap, ...) is
// respected: install.sh leaves its packages alone and check() just reports it.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { defineModule, firstLine, type Context } from '../../src/core/kit.ts';

/** systemd is PID 1 (false in containers and some WSL setups). */
const hasSystemd = (): boolean => existsSync('/run/systemd/system');

/** Package list from install.sh (single source of truth). */
async function packages(ctx: Context): Promise<string[]> {
  const out = await ctx.runScript('docker', ['--list']);
  return out.split('\n').filter(Boolean);
}

async function installedPackages(ctx: Context, wanted: string[]): Promise<Set<string>> {
  const result = await ctx.tryRun(
    `dpkg-query -W -f='\${Package} \${Status}\\n' ${wanted.join(' ')} 2>/dev/null`,
  );
  return new Set(
    result.stdout
      .split('\n')
      .filter((line) => line.endsWith('install ok installed'))
      .map((line) => line.split(' ')[0] ?? ''),
  );
}

interface GroupState {
  exists: boolean;
  /** The user is a member according to the group database (/etc/group). */
  member: boolean;
  /** ...and the current login session already has it (needs a re-login after usermod). */
  effective: boolean;
}

/** Synchronous so nextSteps() can use it too. Read-only. */
function dockerGroup(user: string): GroupState {
  const groups = (args: string[]): string[] => {
    try {
      return execFileSync('id', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split(/\s+/);
    } catch {
      return [];
    }
  };
  let exists = false;
  try {
    execFileSync('getent', ['group', 'docker'], { stdio: 'ignore' });
    exists = true;
  } catch {
    // no docker group
  }
  return {
    exists,
    member: groups(['-nG', user]).includes('docker'),
    // `id -nG` without a user reports this process's groups, i.e. the session's.
    effective: groups(['-nG']).includes('docker'),
  };
}

const needsRelogin = (g: GroupState): boolean => g.member && !g.effective;

export default defineModule({
  id: 'docker',
  name: 'Docker',
  group: 'system',
  description: 'Docker Engine with the buildx and compose plugins',
  deps: ['base'],
  sudo: true,
  defaultSelected: true,

  // Mirrors what install.sh would do; true means install.sh would change nothing.
  async isInstalled(ctx) {
    if (!(await ctx.exists('docker'))) return false;
    const wanted = await packages(ctx);
    const installed = await installedPackages(ctx, wanted);
    if (installed.has('docker-ce-cli')) {
      // Docker's own packages: all of them, and the service enabled where systemd runs.
      if (wanted.some((pkg) => !installed.has(pkg))) return false;
      if (hasSystemd()) {
        const svc = await ctx.tryRun('systemctl is-enabled --quiet docker.service && systemctl is-active --quiet docker.service');
        if (!svc.ok) return false;
      }
    }
    const group = dockerGroup(ctx.env.user);
    return !group.exists || group.member;
  },

  async install(ctx) {
    ctx.progress('setting up Docker (apt repository, packages, service, group)');
    await ctx.runScript('docker');
  },

  async check(ctx) {
    const cli = await ctx.tryRun('docker --version'); // "Docker version 29.1.2, build 0000000"
    if (!cli.ok) {
      return [{ status: 'fail', label: 'Docker', detail: 'docker command not found', hint: 'run `zaun install --only docker`' }];
    }
    const version = firstLine(cli.stdout).replace(/^Docker version ([^,]+).*/, '$1');
    const results = [];

    // Daemon: `docker info` needs a running dockerd AND permission on its socket.
    const info = await ctx.tryRun("docker info --format '{{.ServerVersion}}'", { timeoutMs: 15_000 });
    const group = dockerGroup(ctx.env.user);
    const err = `${info.stderr}\n${info.stdout}`;
    if (info.ok) {
      results.push({ status: 'ok' as const, label: `Docker ${version}`, detail: `daemon ${firstLine(info.stdout)} reachable` });
    } else if (/permission denied/i.test(err)) {
      results.push(
        needsRelogin(group)
          ? {
              status: 'warn' as const,
              label: `Docker ${version}`,
              detail: "you're in the docker group, but this session isn't yet",
              hint: 'log out and back in, or run `newgrp docker`',
            }
          : {
              status: 'fail' as const,
              label: `Docker ${version}`,
              detail: 'no permission to use the Docker daemon',
              hint: 'run `sudo usermod -aG docker $USER`, then log out and back in',
            },
      );
    } else {
      results.push({
        status: 'fail' as const,
        label: `Docker ${version}`,
        detail: 'daemon not reachable',
        hint: hasSystemd()
          ? 'run `sudo systemctl enable --now docker`'
          : 'no systemd on this machine: start `dockerd` yourself',
      });
    }

    const compose = await ctx.tryRun('docker compose version --short');
    results.push(
      compose.ok
        ? { status: 'ok' as const, label: 'Docker Compose', detail: firstLine(compose.stdout) }
        : {
            status: 'fail' as const,
            label: 'Docker Compose',
            detail: '`docker compose` not available',
            hint: 'run `zaun install --only docker` (or install the compose plugin from where your Docker came from)',
          },
    );

    // Daemon is fine, but a fresh group membership isn't active in this session yet:
    // `docker` works here only through some other route (e.g. sudo/rootless); still worth a hint.
    if (info.ok && needsRelogin(group)) {
      results.push({
        status: 'warn' as const,
        label: 'docker group',
        detail: "you're in the docker group, but this session isn't yet",
        hint: 'log out and back in, or run `newgrp docker`',
      });
    }
    return results;
  },

  nextSteps(ctx) {
    const steps: string[] = [];
    if (needsRelogin(dockerGroup(ctx.env.user))) {
      steps.push('Log out and back in (or run `newgrp docker`) so `docker` works without sudo');
    }
    if (!hasSystemd()) {
      steps.push('No systemd here: start the Docker daemon yourself (`sudo dockerd`)');
    }
    return steps;
  },
});
