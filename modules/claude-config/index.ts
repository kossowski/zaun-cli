// claude-config: Claude Code's statusline script and the base settings.
//
// - ~/.claude/statusline.sh is a SYMLINK to config/claude/statusline.sh
//   (zaun owns the script; edits in the repo apply immediately).
// - ~/.claude/settings.json is MERGED: existing file + config/claude/settings.json
//   + your private overlay ~/.zaun-local/claude/settings.json. Claude Code writes
//   to this file itself (/config, permissions, ...), so it can't be a symlink;
//   keys only Claude Code or you wrote are kept.

import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  defineModule,
  mergeDrift,
  mergeJsonFile,
  symlinkWithBackup,
  tildify,
  type CheckResult,
  type Context,
} from '../../src/core/kit.ts';

function files(ctx: Context) {
  const claudeDir = join(ctx.paths.home, '.claude');
  return {
    script: join(ctx.paths.configDir, 'claude', 'statusline.sh'),
    scriptTarget: join(claudeDir, 'statusline.sh'),
    base: join(ctx.paths.configDir, 'claude', 'settings.json'),
    overlay: join(ctx.paths.localDir, 'claude', 'settings.json'),
    settings: join(claudeDir, 'settings.json'),
  };
}

function isLinkTo(target: string, source: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink() && resolve(dirname(target), readlinkSync(target)) === resolve(source);
  } catch {
    return false;
  }
}

/** Dry run of the settings.json merge (read-only). Throws if a file can't be parsed. */
function settingsState(ctx: Context) {
  const f = files(ctx);
  return mergeDrift(f.settings, { base: f.base, overlays: [f.overlay] }, 'json');
}

export default defineModule({
  id: 'claude-config',
  name: 'Claude Code config',
  group: 'config',
  description: 'Statusline and merged settings.json for Claude Code',
  deps: ['claude-code'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    const f = files(ctx);
    if (!isLinkTo(f.scriptTarget, f.script)) return false;
    try {
      const s = settingsState(ctx);
      return s.exists && !s.isSymlink && s.drift.length === 0;
    } catch {
      return false; // unparsable: let install report the error
    }
  },

  async install(ctx) {
    const f = files(ctx);

    ctx.progress('linking statusline.sh');
    const link = symlinkWithBackup(ctx, f.script, f.scriptTarget);
    ctx.log.info(`~/.claude/statusline.sh: ${link}`);

    ctx.progress('merging settings.json');
    const merge = mergeJsonFile(ctx, f.settings, { base: f.base, overlays: [f.overlay] });
    ctx.log.info(
      `~/.claude/settings.json: ${merge}` + (existsSync(f.overlay) ? ` (with overlay ${tildify(f.overlay)})` : ''),
    );

    if (!(await ctx.exists('jq'))) ctx.log.warn('The statusline needs jq: run `zaun install --only base`');
  },

  async check(ctx) {
    const f = files(ctx);
    const results: CheckResult[] = [];
    const fix = 'run `zaun install --only claude-config`';

    if (isLinkTo(f.scriptTarget, f.script)) {
      results.push({ status: 'ok', label: 'Claude statusline', detail: '~/.claude/statusline.sh' });
    } else {
      const detail = existsSync(f.scriptTarget) ? 'not linked to zaun’s script' : '~/.claude/statusline.sh missing';
      results.push({ status: 'fail', label: 'Claude statusline', detail, hint: fix });
    }

    try {
      const s = settingsState(ctx);
      if (!s.exists) {
        results.push({ status: 'fail', label: 'Claude settings', detail: '~/.claude/settings.json missing', hint: fix });
      } else if (s.drift.length > 0 || s.isSymlink) {
        const detail = s.isSymlink ? 'is a symlink, zaun writes a real file' : `differs in: ${s.drift.join(', ')}`;
        results.push({ status: 'warn', label: 'Claude settings', detail, hint: fix });
      } else {
        const overlay = existsSync(f.overlay) ? 'base + overlay' : 'base';
        results.push({ status: 'ok', label: 'Claude settings', detail: `${overlay} merged` });
      }
    } catch (err) {
      results.push({ status: 'fail', label: 'Claude settings', detail: (err as Error).message });
    }

    // The statusline script parses Claude Code's JSON with jq.
    if (!(await ctx.exists('jq'))) {
      results.push({
        status: 'fail',
        label: 'jq (for the statusline)',
        detail: 'not installed',
        hint: 'run `zaun install --only base`',
      });
    }
    return results;
  },
});
