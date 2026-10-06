// codex: OpenAI's Codex CLI, installed with the official standalone installer
// (see install.sh). zaun only installs when `codex` is missing; Codex offers
// its own updates.

import { defineModule, firstLine, type Context } from '../../src/core/kit.ts';

/** `codex login status` exits 0 when logged in (ChatGPT or API key) and non-zero otherwise. */
async function loginStatus(ctx: Context) {
  return ctx.tryRun('codex login status', { timeoutMs: 15_000 });
}

export default defineModule({
  id: 'codex',
  name: 'Codex CLI',
  group: 'agents',
  description: "OpenAI's coding agent, official standalone installer",
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    return ctx.exists('codex');
  },

  async install(ctx) {
    ctx.progress('running the official Codex installer');
    await ctx.runScript('codex');
  },

  async check(ctx) {
    const version = await ctx.tryRun('codex --version', { timeoutMs: 15_000 });
    if (!version.ok) {
      return [
        {
          status: 'fail',
          label: 'Codex CLI',
          detail: 'not installed',
          hint: 'run `zaun install --only codex`',
        },
      ];
    }
    // "codex-cli 0.160.0" → "0.160.0"
    const label = `Codex CLI ${firstLine(version.stdout).replace(/^codex-cli\s*/, '')}`;
    const login = await loginStatus(ctx);
    if (!login.ok) {
      return [
        {
          status: 'warn',
          label,
          detail: 'not logged in',
          hint: 'run `codex login` (headless: `codex login --device-auth`)',
        },
      ];
    }
    // "Logged in using ChatGPT" (older versions print it on stderr)
    const detail = firstLine(login.stdout || login.stderr);
    return [{ status: 'ok', label, detail }];
  },

  async nextSteps(ctx) {
    // Read-only: only ask the user to log in if Codex says they aren't.
    return (await loginStatus(ctx)).ok ? [] : ['Run `codex login` (headless: `codex login --device-auth`)'];
  },
});
