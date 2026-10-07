// The private overlay: ~/.zaun-local holds your personal additions on top of
// the public config (claude/settings.json, codex/config.toml).
// It can be a plain folder or a clone of your own private git repo.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { localDir } from './paths.ts';

/** Entries zaun itself creates in ~/.zaun-local; they don't count as "user content". */
const OWN_ENTRIES = new Set(['state.json', 'logs', 'backups']);

export function overlayIsEmpty(dir = localDir()): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).every((entry) => OWN_ENTRIES.has(entry));
}

export function overlayIsGitRepo(dir = localDir()): boolean {
  return existsSync(join(dir, '.git'));
}

/**
 * Clone `url` into ~/.zaun-local. git refuses to clone into a non-empty folder,
 * and ours may already hold state.json/logs, so clone next to it and move the
 * contents in. Runs attached to the terminal so SSH/HTTPS credential prompts work.
 */
export function cloneOverlay(url: string, dir = localDir()): void {
  if (!overlayIsEmpty(dir)) {
    throw new Error(`${dir} already contains files; clone skipped. Move them away first.`);
  }
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.clone-${process.pid}`);
  const result = spawnSync('git', ['clone', '--quiet', url, tmp], { stdio: 'inherit' });
  if (result.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`git clone ${url} failed`);
  }
  for (const entry of readdirSync(tmp)) {
    if (OWN_ENTRIES.has(entry)) continue; // never overwrite our own state with a committed copy
    renameSync(join(tmp, entry), join(dir, entry));
  }
  rmSync(tmp, { recursive: true, force: true });
}

/** `git pull --ff-only` in the overlay. Returns an error message, or null on success. */
export function pullOverlay(dir = localDir()): string | null {
  const result = spawnSync('git', ['-C', dir, 'pull', '--ff-only', '--quiet'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  return result.status === 0 ? null : (result.stderr.trim() || 'git pull failed');
}
