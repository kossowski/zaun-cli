// neovim: the latest stable Neovim from the official GitHub release, unpacked
// into ~/.local/opt/nvim (see install.sh). Updates: install.sh --update.
// No config is shipped: ~/.config/nvim stays yours.

import { defineModule, firstLine } from '../../src/core/kit.ts';

export default defineModule({
  id: 'neovim',
  name: 'Neovim',
  group: 'shell',
  description: 'Latest stable Neovim from the official release (apt has 0.9)',
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    return ctx.exists('nvim');
  },

  async install(ctx) {
    ctx.progress('downloading the latest Neovim release');
    await ctx.runScript('neovim');
  },

  async check(ctx) {
    const version = await ctx.tryRun('nvim --version');
    if (!version.ok) {
      return [{ status: 'fail', label: 'Neovim', detail: 'nvim not found', hint: 'run `zaun install --only neovim`' }];
    }
    // "NVIM v0.12.5"
    const label = firstLine(version.stdout).replace(/^NVIM /, 'Neovim ');
    const [, major = 0, minor = 0] = /v(\d+)\.(\d+)/.exec(label)?.map(Number) ?? [];
    if (major === 0 && minor < 10) {
      return [
        {
          status: 'warn',
          label,
          detail: 'older than 0.10, many plugins need newer',
          hint: 'remove it (e.g. `sudo apt remove neovim`), then run `zaun install --only neovim`',
        },
      ];
    }
    return [{ status: 'ok', label }];
  },
});
