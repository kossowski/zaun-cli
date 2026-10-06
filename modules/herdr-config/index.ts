// herdr-config: a starter ~/.config/herdr/config.toml, SEEDED from
// config/herdr/config.toml only if the file doesn't exist. After that the file
// belongs to you (and to herdr, which writes to it too); zaun never overwrites it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineModule, firstLine, seedFile, type CheckResult, type Context } from '../../src/core/kit.ts';

function files(ctx: Context) {
  return {
    source: join(ctx.paths.configDir, 'herdr', 'config.toml'),
    target: join(ctx.paths.home, '.config', 'herdr', 'config.toml'),
  };
}

/** `[terminal] default_shell = "..."` from the config, if set (a simple text scan is enough here). */
function defaultShell(configText: string): string | undefined {
  const terminal = configText.split(/^\s*\[/m).find((section) => /^terminal\s*\]/.test(section));
  return terminal?.match(/^\s*default_shell\s*=\s*"([^"]+)"/m)?.[1];
}

export default defineModule({
  id: 'herdr-config',
  name: 'herdr config',
  group: 'config',
  description: 'Starter ~/.config/herdr/config.toml, only if missing',
  deps: ['herdr'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    return existsSync(files(ctx).target);
  },

  async install(ctx) {
    const f = files(ctx);
    const result = seedFile(ctx, f.source, f.target);
    ctx.log.info(`~/.config/herdr/config.toml: ${result === 'unchanged' ? 'exists, left alone' : result}`);
  },

  async check(ctx) {
    const f = files(ctx);
    if (!existsSync(f.target)) {
      return [
        {
          status: 'fail',
          label: 'herdr config',
          detail: '~/.config/herdr/config.toml missing',
          hint: 'run `zaun install --only herdr-config`',
        },
      ];
    }

    const results: CheckResult[] = [];
    // herdr validates its own config; `herdr config check` only reads it.
    if (await ctx.exists('herdr')) {
      const validation = await ctx.tryRun('herdr config check', { timeoutMs: 15_000 });
      if (validation.ok) {
        results.push({ status: 'ok', label: 'herdr config', detail: '~/.config/herdr/config.toml' });
      } else {
        const output = (validation.stdout + '\n' + validation.stderr).trim();
        const problem = output.split('\n').find((l) => /error|invalid|unknown/i.test(l)) ?? firstLine(output);
        results.push({ status: 'warn', label: 'herdr config', detail: problem, hint: 'run `herdr config check`' });
      }
    } else {
      results.push({ status: 'ok', label: 'herdr config', detail: '~/.config/herdr/config.toml' });
    }

    // The starter config uses zsh; without it new herdr panes can't start.
    const shell = defaultShell(readFileSync(f.target, 'utf8'));
    if (shell?.startsWith('/') && !existsSync(shell)) {
      results.push({
        status: 'warn',
        label: 'herdr default shell',
        detail: `${shell} not found`,
        hint: 'run `zaun install --only shell` or change `default_shell` in ~/.config/herdr/config.toml',
      });
    }
    return results;
  },
});
