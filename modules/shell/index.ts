// shell: zsh as the login shell, the starship prompt, two zsh plugins and zaun's zsh config.
//
// install.sh installs zsh, the plugins (apt) and starship, and changes the login shell.
// The two config files are handled here, because they need backups:
// - ~/.config/starship.toml → symlink to config/starship/starship.toml
// - ~/.zshrc               → a managed block that sources config/zsh/zaun.zsh
// No nextSteps: `zaun install` itself ends with "open a new terminal (or `exec zsh`)".

import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  defineModule,
  firstLine,
  shellQuote,
  symlinkWithBackup,
  tildify,
  upsertBlock,
  upsertManagedBlock,
  type CheckResult,
  type Context,
} from '../../src/core/kit.ts';

const starshipSource = (ctx: Context) => join(ctx.paths.configDir, 'starship', 'starship.toml');
const starshipTarget = (ctx: Context) => join(ctx.paths.home, '.config', 'starship.toml');
const zshrc = (ctx: Context) => join(ctx.paths.home, '.zshrc');

/** The lines zaun keeps in ~/.zshrc. The path is resolved now, so the block works without $ZAUN_DIR. */
function zshrcBlock(ctx: Context): string {
  const file = shellQuote(join(ctx.paths.configDir, 'zsh', 'zaun.zsh'));
  return `[[ -r ${file} ]] && source ${file}`;
}

/** apt packages config/zsh/zaun.zsh sources from /usr/share/<name>/<name>.zsh. */
const PLUGINS = ['zsh-autosuggestions', 'zsh-syntax-highlighting'];

const pluginFile = (name: string) => `/usr/share/${name}/${name}.zsh`;

const missingPlugins = () => PLUGINS.filter((name) => !existsSync(pluginFile(name)));

/** The user's login shell from the passwd database (not $SHELL, which is just this session). */
async function loginShell(ctx: Context): Promise<string> {
  const r = await ctx.tryRun(`getent passwd ${shellQuote(ctx.env.user)} | cut -d: -f7`);
  return r.stdout.trim();
}

/** /usr/bin/zsh and /bin/zsh are the same program on Ubuntu and Debian, so compare the name only. */
const isZsh = (shell: string) => shell.split('/').pop() === 'zsh';

async function zshPath(ctx: Context): Promise<string | null> {
  const r = await ctx.tryRun('command -v zsh');
  return r.ok ? r.stdout.trim() : null;
}

function symlinkOk(ctx: Context): boolean {
  const target = starshipTarget(ctx);
  try {
    if (!lstatSync(target).isSymbolicLink()) return false;
    return resolve(dirname(target), readlinkSync(target)) === resolve(starshipSource(ctx));
  } catch {
    return false;
  }
}

function blockOk(ctx: Context): boolean {
  if (!existsSync(zshrc(ctx))) return false;
  const content = readFileSync(zshrc(ctx), 'utf8');
  return upsertBlock(content, zshrcBlock(ctx)) === content;
}

export default defineModule({
  id: 'shell',
  name: 'zsh + starship',
  group: 'shell',
  description: 'zsh as login shell, starship prompt, autosuggestions + syntax highlighting',
  deps: ['base'],
  sudo: true,
  defaultSelected: true,

  async isInstalled(ctx) {
    const zsh = await zshPath(ctx);
    return (
      zsh !== null &&
      isZsh(await loginShell(ctx)) &&
      (await ctx.exists('starship')) &&
      missingPlugins().length === 0 &&
      symlinkOk(ctx) &&
      blockOk(ctx)
    );
  },

  async install(ctx) {
    ctx.progress('installing zsh, plugins and starship');
    await ctx.runScript('shell');

    ctx.progress('linking starship.toml');
    const link = symlinkWithBackup(ctx, starshipSource(ctx), starshipTarget(ctx));
    ctx.log.info(`~/.config/starship.toml: ${link}`);

    ctx.progress('updating ~/.zshrc');
    const block = upsertManagedBlock(ctx, zshrc(ctx), zshrcBlock(ctx));
    ctx.log.info(`~/.zshrc zaun block: ${block}`);
  },

  async check(ctx) {
    const results: CheckResult[] = [];

    const zsh = await zshPath(ctx);
    const login = await loginShell(ctx);
    if (!zsh) {
      results.push({ status: 'fail', label: 'zsh', detail: 'not installed', hint: 'run `zaun install --only shell`' });
    } else if (!isZsh(login)) {
      results.push({
        status: 'fail',
        label: 'zsh is not the login shell',
        detail: `login shell: ${login || 'unknown'}`,
        hint: 'run `zaun install --only shell`',
      });
    } else {
      const v = await ctx.tryRun('zsh --version'); // "zsh 5.9 (aarch64-unknown-linux-gnu)"
      results.push({ status: 'ok', label: 'zsh is the login shell', detail: firstLine(v.stdout).split(' ').slice(0, 2).join(' ') });
    }

    const starship = await ctx.tryRun('starship --version'); // "starship 1.23.0"
    results.push(
      starship.ok
        ? { status: 'ok', label: firstLine(starship.stdout) }
        : { status: 'fail', label: 'starship', detail: 'not installed', hint: 'run `zaun install --only shell`' },
    );

    const missing = missingPlugins();
    results.push(
      missing.length === 0
        ? { status: 'ok', label: 'zsh plugins', detail: 'autosuggestions · syntax highlighting' }
        : {
            status: 'warn',
            label: 'zsh plugins missing',
            detail: missing.join(', '),
            hint: 'run `zaun install --only shell`',
          },
    );

    const configProblems: string[] = [];
    if (!symlinkOk(ctx)) configProblems.push(`${tildify(starshipTarget(ctx))} is not linked to zaun's starship.toml`);
    if (!blockOk(ctx)) configProblems.push('zaun block in ~/.zshrc missing or outdated');
    results.push(
      configProblems.length === 0
        ? { status: 'ok', label: 'Shell config', detail: 'starship.toml linked · ~/.zshrc block present' }
        : {
            status: 'fail',
            label: 'Shell config',
            detail: configProblems.join(' · '),
            hint: 'run `zaun install --only shell`',
          },
    );
    return results;
  },
});
