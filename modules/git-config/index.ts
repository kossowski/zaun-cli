// git-config: git identity (user.name / user.email) plus a few global defaults.
//
// The identity comes from ctx.options (asked by `zaun install`, remembered in
// ~/.zaun-local/state.json). The defaults and the commands live in install.sh.

import { defineModule, shellQuote, type CheckResult, type Context } from '../../src/core/kit.ts';

/** `key=value` pairs from install.sh (single source of truth). */
async function defaults(ctx: Context): Promise<[string, string][]> {
  const out = await ctx.runScript('git-config', ['--list']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    });
}

async function getGlobal(ctx: Context, key: string): Promise<string> {
  const r = await ctx.tryRun(`git config --global --get ${shellQuote(key)}`);
  return r.ok ? r.stdout.trim() : '';
}

/** Defaults whose global value differs from zaun's, as "key (is: x)". */
async function outdatedDefaults(ctx: Context): Promise<string[]> {
  const wanted = await defaults(ctx);
  const current = await Promise.all(wanted.map(([key]) => getGlobal(ctx, key)));
  return wanted
    .map(([key, value], i) => (current[i] === value ? null : `${key} (is: ${current[i] || 'unset'})`))
    .filter((x): x is string => x !== null);
}

export default defineModule({
  id: 'git-config',
  name: 'Git config',
  group: 'config',
  description: 'Your git identity plus sensible defaults',
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    const [name, email] = await Promise.all([getGlobal(ctx, 'user.name'), getGlobal(ctx, 'user.email')]);
    // A name/email given for this run must match; otherwise any existing value counts.
    const nameOk = ctx.options.gitName ? name === ctx.options.gitName : name !== '';
    const emailOk = ctx.options.gitEmail ? email === ctx.options.gitEmail : email !== '';
    return nameOk && emailOk && (await outdatedDefaults(ctx)).length === 0;
  },

  async install(ctx) {
    const args: string[] = [];
    if (ctx.options.gitName) args.push('--name', ctx.options.gitName);
    if (ctx.options.gitEmail) args.push('--email', ctx.options.gitEmail);
    ctx.progress('setting git defaults');
    await ctx.runScript('git-config', args);

    // Missing identity is not an error (non-interactive runs may not know it), but say so.
    for (const key of ['user.name', 'user.email']) {
      if (!(await getGlobal(ctx, key))) {
        ctx.log.warn(`git ${key} is not set. Run: git config --global ${key} "..."`);
      }
    }
  },

  async check(ctx) {
    const results: CheckResult[] = [];
    const [name, email] = await Promise.all([getGlobal(ctx, 'user.name'), getGlobal(ctx, 'user.email')]);
    const missing = [!name && 'user.name', !email && 'user.email'].filter(Boolean);
    results.push(
      missing.length === 0
        ? { status: 'ok', label: 'Git identity', detail: `${name} <${email}>` }
        : {
            status: 'warn',
            label: 'Git identity incomplete',
            detail: `missing: ${missing.join(', ')}`,
            hint: 'run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`',
          },
    );

    const outdated = await outdatedDefaults(ctx);
    results.push(
      outdated.length === 0
        ? { status: 'ok', label: 'Git defaults', detail: 'defaultBranch main · autoSetupRemote · prune' }
        : {
            status: 'warn',
            label: 'Git defaults differ',
            detail: outdated.join(', '),
            hint: 'run `zaun install --only git-config` (or keep yours on purpose)',
          },
    );
    return results;
  },
});
