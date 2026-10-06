// base: apt packages every other module relies on (git, curl, jq, ripgrep, ...).
//
// This is the reference module. Copy its shape when writing a new one:
// - the actual installing happens in install.sh (plain bash, runnable on its own)
// - index.ts holds metadata, a fast isInstalled(), a read-only check() and nextSteps()

import { defineModule, firstLine, type Context } from '../../src/core/kit.ts';

/** The package list lives in install.sh (single source of truth); ask it. */
async function packages(ctx: Context): Promise<string[]> {
  const out = await ctx.runScript('base', ['--list']);
  return out.split('\n').filter(Boolean);
}

async function missingPackages(ctx: Context): Promise<string[]> {
  const wanted = await packages(ctx);
  // One dpkg-query call for all packages; unknown packages are reported on stderr, which we ignore.
  const result = await ctx.tryRun(
    `dpkg-query -W -f='\${Package} \${Status}\\n' ${wanted.join(' ')} 2>/dev/null`,
  );
  const installed = new Set(
    result.stdout
      .split('\n')
      .filter((line) => line.endsWith('install ok installed'))
      .map((line) => line.split(' ')[0]),
  );
  return wanted.filter((pkg) => !installed.has(pkg));
}

export default defineModule({
  id: 'base',
  name: 'Base packages',
  group: 'system',
  description: 'git, curl, jq, ripgrep, fd, build tools',
  sudo: true,
  defaultSelected: true,

  async isInstalled(ctx) {
    return (await missingPackages(ctx)).length === 0;
  },

  async install(ctx) {
    ctx.progress('installing apt packages');
    await ctx.runScript('base');
  },

  async check(ctx) {
    const missing = await missingPackages(ctx);
    if (missing.length > 0) {
      return [
        {
          status: 'fail',
          label: 'Base packages',
          detail: `missing: ${missing.join(', ')}`,
          hint: 'run `zaun install --only base`',
        },
      ];
    }

    // All there: show the versions of the tools people actually type.
    const versions = await Promise.all([
      ctx.tryRun('git --version'), // "git version 2.43.0"
      ctx.tryRun('rg --version'), // "ripgrep 14.1.0 ..."
    ]);
    const detail = versions
      .filter((r) => r.ok)
      .map((r) => firstLine(r.stdout).replace('git version', 'git').split(' ').slice(0, 2).join(' '))
      .join(' · ');
    return [{ status: 'ok', label: 'Base packages', detail }];
  },
});
