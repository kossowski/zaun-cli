// python: uv (https://docs.astral.sh/uv/) and a Python managed by uv.
//
// install.sh does the work; this file only checks for it.

import { defineModule, firstLine, shellQuote, type CheckResult, type Context } from '../../src/core/kit.ts';

/**
 * Path of a uv-managed Python, or null. `--managed-python` ignores the system /usr/bin/python3;
 * Run in `/` so a .python-version file in the current directory doesn't change the answer.
 */
async function managedPython(ctx: Context): Promise<string | null> {
  const r = await ctx.tryRun('uv python find --managed-python', { cwd: '/' });
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export default defineModule({
  id: 'python',
  name: 'Python',
  group: 'runtimes',
  description: 'uv and a uv-managed Python',
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    return (await ctx.exists('uv')) && (await managedPython(ctx)) !== null;
  },

  async install(ctx) {
    ctx.progress('installing uv and Python');
    await ctx.runScript('python');
  },

  async check(ctx) {
    const uv = await ctx.tryRun('uv --version'); // "uv 0.9.2 (...)"
    if (!uv.ok) {
      return [{ status: 'fail', label: 'uv', detail: 'not installed', hint: 'run `zaun install --only python`' }];
    }
    const results: CheckResult[] = [{ status: 'ok', label: firstLine(uv.stdout).split(' ').slice(0, 2).join(' ') }];

    const python = await managedPython(ctx);
    if (!python) {
      results.push({ status: 'fail', label: 'No uv-managed Python', hint: 'run `zaun install --only python`' });
    } else {
      const version = await ctx.tryRun(`${shellQuote(python)} --version`); // "Python 3.14.0"
      results.push({ status: 'ok', label: firstLine(version.stdout) || 'Python', detail: 'managed by uv' });
    }
    return results;
  },
});
