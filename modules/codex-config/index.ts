// codex-config: ~/.codex/config.toml, MERGED from
//   existing file + config/codex/config.toml + ~/.zaun-local/codex/config.toml
// Codex writes to this file itself (trusted projects, notices, ...), so it is a
// real file and everything Codex or you wrote stays. Comments in it are not
// preserved by the merge.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineModule, mergeDrift, mergeTomlFile, tildify, type Context } from '../../src/core/kit.ts';

function files(ctx: Context) {
  return {
    base: join(ctx.paths.configDir, 'codex', 'config.toml'),
    overlay: join(ctx.paths.localDir, 'codex', 'config.toml'),
    config: join(ctx.paths.home, '.codex', 'config.toml'),
  };
}

/** Dry run of the config.toml merge (read-only). Throws if a file can't be parsed. */
function configState(ctx: Context) {
  const f = files(ctx);
  return mergeDrift(f.config, { base: f.base, overlays: [f.overlay] }, 'toml');
}

export default defineModule({
  id: 'codex-config',
  name: 'Codex config',
  group: 'config',
  description: 'Merged ~/.codex/config.toml',
  deps: ['codex'],
  sudo: false,
  defaultSelected: true,

  async isInstalled(ctx) {
    try {
      const s = configState(ctx);
      return s.exists && !s.isSymlink && s.drift.length === 0;
    } catch {
      return false; // unparsable: let install report the error
    }
  },

  async install(ctx) {
    const f = files(ctx);
    ctx.progress('merging ~/.codex/config.toml');
    const result = mergeTomlFile(ctx, f.config, { base: f.base, overlays: [f.overlay] });
    ctx.log.info(
      `~/.codex/config.toml: ${result}` + (existsSync(f.overlay) ? ` (with overlay ${tildify(f.overlay)})` : ''),
    );
  },

  async check(ctx) {
    const f = files(ctx);
    const fix = 'run `zaun install --only codex-config`';
    try {
      const s = configState(ctx);
      if (!s.exists) {
        return [{ status: 'fail', label: 'Codex config', detail: '~/.codex/config.toml missing', hint: fix }];
      }
      if (s.isSymlink || s.drift.length > 0) {
        const detail = s.isSymlink ? 'is a symlink, zaun writes a real file' : `differs in: ${s.drift.join(', ')}`;
        return [{ status: 'warn', label: 'Codex config', detail, hint: fix }];
      }
      const overlay = existsSync(f.overlay) ? 'base + overlay' : 'base';
      return [{ status: 'ok', label: 'Codex config', detail: `${overlay} merged` }];
    } catch (err) {
      return [{ status: 'fail', label: 'Codex config', detail: (err as Error).message }];
    }
  },
});
