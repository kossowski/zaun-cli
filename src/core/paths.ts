import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Repository root, derived from this file's location (src/core/paths.ts → ../..). */
export const ZAUN_DIR = resolve(import.meta.dirname, '..', '..');

/** ~/.zaun-local. Can be overridden with ZAUN_LOCAL_DIR (handy for tests). */
export function localDir(): string {
  return process.env.ZAUN_LOCAL_DIR ?? join(homedir(), '.zaun-local');
}

/** Filesystem-safe timestamp, e.g. 2026-10-05_16-30-12. Used for logs and backups. */
export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + '/') ? '~' + path.slice(home.length) : path;
}
