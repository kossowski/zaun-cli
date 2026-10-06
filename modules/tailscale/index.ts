// tailscale: Tailscale via the official installer (which adds Tailscale's apt repo).
//
// install.sh installs and makes sure tailscaled runs. Logging in (`sudo tailscale up`)
// needs the user, so it's a next step, and check() warns until it's done.

import { existsSync } from 'node:fs';
import { defineModule, firstLine, type Context } from '../../src/core/kit.ts';

/** systemd is PID 1 (false in containers and some WSL setups). */
const hasSystemd = (): boolean => existsSync('/run/systemd/system');

interface Status {
  BackendState?: string; // "Running", "NeedsLogin", "Stopped", "NoState", ...
  Self?: { DNSName?: string; TailscaleIPs?: string[] };
}

/** undefined if tailscaled can't be reached. */
async function readStatus(ctx: Context): Promise<Status | undefined> {
  // Exits non-zero when logged out, so parse the JSON regardless of the exit code.
  const res = await ctx.tryRun('tailscale status --json', { timeoutMs: 10_000 });
  try {
    return JSON.parse(res.stdout) as Status;
  } catch {
    return undefined;
  }
}

export default defineModule({
  id: 'tailscale',
  name: 'Tailscale',
  group: 'system',
  description: 'Private network access to this machine',
  deps: ['base'],
  sudo: true,
  defaultSelected: true,

  // Mirrors install.sh: installed, and (where systemd runs) tailscaled enabled + running.
  async isInstalled(ctx) {
    if (!(await ctx.exists('tailscale'))) return false;
    if (!hasSystemd()) return true;
    return (await ctx.tryRun('systemctl is-enabled --quiet tailscaled && systemctl is-active --quiet tailscaled')).ok;
  },

  async install(ctx) {
    ctx.progress('installing Tailscale (official installer)');
    await ctx.runScript('tailscale');
  },

  async check(ctx) {
    const version = await ctx.tryRun('tailscale version');
    if (!version.ok) {
      return [{ status: 'fail', label: 'Tailscale', detail: 'tailscale command not found', hint: 'run `zaun install --only tailscale`' }];
    }
    const label = `Tailscale ${firstLine(version.stdout)}`;

    const status = await readStatus(ctx);

    if (!status?.BackendState) {
      return [
        {
          status: 'fail',
          label,
          detail: 'tailscaled is not running',
          hint: hasSystemd()
            ? 'run `sudo systemctl enable --now tailscaled`'
            : 'no systemd on this machine: start `tailscaled` yourself',
        },
      ];
    }

    switch (status.BackendState) {
      case 'Running': {
        const name = status.Self?.DNSName?.replace(/\.$/, '');
        const ip = status.Self?.TailscaleIPs?.[0];
        return [{ status: 'ok', label, detail: ['connected', name, ip].filter(Boolean).join(' · ') }];
      }
      case 'Stopped':
        return [{ status: 'warn', label, detail: 'disconnected (`tailscale down`)', hint: 'run `sudo tailscale up`' }];
      case 'NeedsMachineAuth':
        return [{ status: 'warn', label, detail: 'waiting for an admin to approve this machine', hint: 'approve it in the Tailscale admin console' }];
      default: // NeedsLogin, NoState, Starting
        return [{ status: 'warn', label, detail: `not logged in (${status.BackendState})`, hint: 'run `sudo tailscale up` (add `--ssh` for Tailscale SSH)' }];
    }
  },

  async nextSteps(ctx) {
    const state = (await readStatus(ctx))?.BackendState;
    // Connected, or waiting for an admin: nothing the user can do with `tailscale up`.
    if (state === 'Running' || state === 'NeedsMachineAuth') return [];
    const up = '`sudo tailscale up` to join your tailnet (add `--ssh` for Tailscale SSH)';
    return [state ? `Run ${up}` : `Once tailscaled is running: ${up}`];
  },
});
