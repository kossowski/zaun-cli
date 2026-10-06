// claude-code: Anthropic's Claude Code CLI, installed with the official native
// installer (see install.sh). Native installs update themselves, so zaun only
// installs when `claude` is missing.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineModule, firstLine, type Context } from '../../src/core/kit.ts';

/** Claude Code keeps its login here on Linux. We only ever test that it exists. */
function credentialsFile(ctx: Context): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(ctx.paths.home, '.claude');
  return join(configDir, '.credentials.json');
}

/** Logged in via claude.ai (credentials file) or using an API key from the environment. */
function isLoggedIn(ctx: Context): boolean {
  return existsSync(credentialsFile(ctx)) || Boolean(process.env.ANTHROPIC_API_KEY);
}

export default defineModule({
  id: 'claude-code',
  name: 'Claude Code',
  group: 'agents',
  description: "Anthropic's coding agent, official native installer",
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    return ctx.exists('claude');
  },

  async install(ctx) {
    ctx.progress('running the official Claude Code installer');
    await ctx.runScript('claude-code');
  },

  async check(ctx) {
    const version = await ctx.tryRun('claude --version', { timeoutMs: 15_000 });
    if (!version.ok) {
      return [
        {
          status: 'fail',
          label: 'Claude Code',
          detail: 'not installed',
          hint: 'run `zaun install --only claude-code`',
        },
      ];
    }
    // "2.1.289 (Claude Code)" → "2.1.289"
    const label = `Claude Code ${firstLine(version.stdout).split(' ')[0]}`;
    if (!isLoggedIn(ctx)) {
      return [{ status: 'warn', label, detail: 'not logged in', hint: 'run `claude` to log in' }];
    }
    return [{ status: 'ok', label }];
  },

  nextSteps(ctx) {
    return isLoggedIn(ctx) ? [] : ['Run `claude` to log in to Claude Code'];
  },
});
