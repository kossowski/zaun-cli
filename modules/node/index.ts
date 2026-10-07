// node: fnm, the current Node LTS as default, pnpm via corepack.
//
// install.sh does the work; bootstrap.sh may already have installed fnm + Node
// (zaun needs Node to run), in which case it only finishes the setup.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineModule, firstLine, shellQuote, tildify, type CheckResult, type Context } from '../../src/core/kit.ts';

/** Same default as bootstrap.sh, bin/zaun and config/zsh/zaun.zsh. */
const fnmDir = (ctx: Context) => process.env.FNM_DIR ?? join(ctx.paths.home, '.local', 'share', 'fnm');
const fnmBin = (ctx: Context) => join(fnmDir(ctx), 'fnm');
/** fnm keeps aliases as symlinks to the installation: aliases/default/bin/node. */
const defaultBin = (ctx: Context) => join(fnmDir(ctx), 'aliases', 'default', 'bin');
const nvmDir = (ctx: Context) => join(ctx.paths.home, '.nvm');

export default defineModule({
  id: 'node',
  name: 'Node.js',
  group: 'runtimes',
  description: 'fnm with the current Node LTS, pnpm via corepack',
  deps: ['base'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    const bin = defaultBin(ctx);
    return existsSync(fnmBin(ctx)) && existsSync(join(bin, 'node')) && existsSync(join(bin, 'pnpm'));
  },

  async install(ctx) {
    ctx.progress('installing fnm, Node LTS and pnpm');
    await ctx.runScript('node', [], { env: { FNM_DIR: fnmDir(ctx) } });
    // Later modules need fnm's default Node on PATH.
    ctx.addPath(fnmDir(ctx));
    ctx.addPath(defaultBin(ctx));
    if (existsSync(nvmDir(ctx))) {
      ctx.log.warn('nvm is installed too (~/.nvm). Remove the nvm lines from ~/.zshrc so fnm manages Node.');
    }
  },

  async check(ctx) {
    const results: CheckResult[] = [];
    const fnm = await ctx.tryRun(`${shellQuote(fnmBin(ctx))} --version`); // "fnm 1.38.1"
    if (!fnm.ok) {
      results.push({
        status: 'fail',
        label: 'fnm',
        detail: `not installed (expected ${tildify(fnmBin(ctx))})`,
        hint: 'run `zaun install --only node`',
      });
    } else {
      const bin = defaultBin(ctx);
      const node = await ctx.tryRun(`${shellQuote(join(bin, 'node'))} --version`); // "v24.11.0"
      if (!node.ok) {
        results.push({
          status: 'fail',
          label: 'No default Node version',
          detail: firstLine(fnm.stdout),
          hint: 'run `zaun install --only node`',
        });
      } else {
        results.push({ status: 'ok', label: `Node ${firstLine(node.stdout)}`, detail: `${firstLine(fnm.stdout)} · default` });
        // Only look for the corepack shim: running `pnpm` could download pnpm (not read-only).
        results.push(
          existsSync(join(bin, 'pnpm'))
            ? { status: 'ok', label: 'pnpm', detail: 'via corepack' }
            : { status: 'fail', label: 'pnpm', detail: 'not enabled', hint: 'run `zaun install --only node`' },
        );
      }
    }

    if (existsSync(nvmDir(ctx))) {
      results.push({
        status: 'warn',
        label: 'nvm is installed too',
        detail: '~/.nvm can shadow fnm’s Node',
        hint: 'remove the nvm lines (NVM_DIR, nvm.sh) from ~/.zshrc; zaun never deletes ~/.nvm',
      });
    }
    return results;
  },

  nextSteps(ctx) {
    return existsSync(nvmDir(ctx))
      ? ['Remove the nvm lines from `~/.zshrc` so fnm’s Node is used (zaun leaves ~/.nvm alone)']
      : [];
  },
});
