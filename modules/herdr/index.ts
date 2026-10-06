// herdr: terminal workspace manager for AI coding agents (https://herdr.dev),
// installed with the official installer (see install.sh). Updates: `herdr update`.

import { defineModule, firstLine } from '../../src/core/kit.ts';

export default defineModule({
  id: 'herdr',
  name: 'herdr',
  group: 'agents',
  description: 'Terminal workspace manager for AI coding agents',
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    return ctx.exists('herdr');
  },

  async install(ctx) {
    ctx.progress('running the official herdr installer');
    await ctx.runScript('herdr');
  },

  async check(ctx) {
    const version = await ctx.tryRun('herdr --version', { timeoutMs: 15_000 });
    if (!version.ok) {
      return [
        {
          status: 'fail',
          label: 'herdr',
          detail: 'not installed',
          hint: 'run `zaun install --only herdr`',
        },
      ];
    }
    // "herdr 0.9.3"
    return [{ status: 'ok', label: firstLine(version.stdout) }];
  },
});
