// gh: GitHub CLI from GitHub's official apt repository (cli.github.com/packages).
//
// install.sh adds the repo and installs gh. Authentication needs the user
// (`gh auth login` or a fine-grained token in GH_TOKEN), so check() warns until then.

import { defineModule, firstLine, type Context } from '../../src/core/kit.ts';

const AUTH_HINT = 'run `gh auth login`, or use a fine-grained token: see docs/github-token.md';

/** gh is managed by apt (as opposed to a manual binary, Homebrew, ...). */
async function fromApt(ctx: Context): Promise<boolean> {
  return (await ctx.tryRun(`dpkg-query -W -f='\${Status}' gh 2>/dev/null | grep -q 'install ok installed'`)).ok;
}

async function hasOfficialRepo(ctx: Context): Promise<boolean> {
  return (await ctx.tryRun('grep -rqs "cli.github.com/packages" /etc/apt/sources.list /etc/apt/sources.list.d/')).ok;
}

export default defineModule({
  id: 'gh',
  name: 'GitHub CLI',
  group: 'system',
  description: "gh, from GitHub's official apt repository",
  deps: ['base'],
  sudo: true,
  defaultSelected: true,

  // Mirrors install.sh: nothing to do if gh exists and is either not apt-managed
  // (left alone) or GitHub's repo is already set up.
  async isInstalled(ctx) {
    if (!(await ctx.exists('gh'))) return false;
    return !(await fromApt(ctx)) || (await hasOfficialRepo(ctx));
  },

  async install(ctx) {
    ctx.progress("installing gh from GitHub's apt repository");
    await ctx.runScript('gh');
  },

  async check(ctx) {
    const version = await ctx.tryRun('gh --version'); // "gh version 2.83.0 (2025-11-04)"
    if (!version.ok) {
      return [{ status: 'fail', label: 'GitHub CLI', detail: 'gh command not found', hint: 'run `zaun install --only gh`' }];
    }
    const label = firstLine(version.stdout).replace(/^gh version (\S+).*/, 'gh $1');
    const results = [];

    // The distro's own (outdated) gh package: works, but GitHub's repo is better.
    if ((await fromApt(ctx)) && !(await hasOfficialRepo(ctx))) {
      results.push({
        status: 'warn' as const,
        label,
        detail: "from the distro's archive (outdated), not GitHub's apt repository",
        hint: 'run `zaun install --only gh` to switch to GitHub\'s repository',
      });
    } else {
      results.push({ status: 'ok' as const, label });
    }

    // Read-only: validates the stored token / GH_TOKEN against github.com.
    const auth = await ctx.tryRun('gh auth status --hostname github.com', { timeoutMs: 15_000 });
    if (auth.ok) {
      // gh prints e.g. "✓ Logged in to github.com account octocat (GH_TOKEN)".
      const line = `${auth.stdout}\n${auth.stderr}`.split('\n').find((l) => /Logged in to/.test(l));
      const detail = line?.replace(/^.*Logged in to github\.com\s*/, '').replace(/^account\s+/, '').trim();
      results.push({ status: 'ok' as const, label: 'gh logged in', detail: detail || undefined });
    } else {
      const reason = `${auth.stderr}\n${auth.stdout}`
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && l !== 'github.com');
      results.push({ status: 'warn' as const, label: 'gh not logged in', detail: reason, hint: AUTH_HINT });
    }
    return results;
  },

  async nextSteps(ctx) {
    const auth = await ctx.tryRun('gh auth status --hostname github.com', { timeoutMs: 15_000 });
    return auth.ok ? [] : ['Run `gh auth login`, or put a fine-grained token in `GH_TOKEN` (see docs/github-token.md)'];
  },
});
