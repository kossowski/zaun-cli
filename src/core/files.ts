// Config strategies: symlink, merge, seed and managed block.
// See docs/architecture.md for when to use which.
//
// Every helper returns what it did ('created' | 'updated' | 'unchanged'), so
// modules can log it, and never destroys a user's file without a backup in
// ~/.zaun-local/backups/<timestamp>/.

import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { Context } from './types.ts';
import { deepMerge, isPlainObject, type PlainObject } from './merge.ts';
import { tildify } from './paths.ts';

export type FileChange = 'created' | 'updated' | 'unchanged';

function lstatOrUndefined(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Write via a temp file + rename, so a crash never leaves a half-written config.
 * `mode` defaults to the existing file's mode, or 0o600 for a new file.
 */
export function writeFileAtomic(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  if (mode === undefined) {
    const stat = lstatOrUndefined(path);
    mode = stat?.isFile() ? stat.mode & 0o777 : 0o600;
  }
  // Keep the replacement private until it is complete, even when preserving
  // a target mode that allows other users to read it.
  const tmp = `${path}.zaun-tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Never created, or already renamed.
    }
    throw err;
  }
}

/** Where `path` goes inside this run's backup folder (mirrors the path below $HOME). */
function backupPathFor(ctx: Context, path: string): string {
  const abs = resolve(path);
  const rel = relative(ctx.paths.home, abs);
  const inside = rel && !rel.startsWith('..') ? rel : join('_root', abs);
  return join(ctx.paths.backupDir, inside);
}

/**
 * Back up a file, directory or symlink into ~/.zaun-local/backups/<timestamp>/.
 * `move: true` moves it away (used before replacing it with a symlink),
 * otherwise it is copied. Returns the backup path, or null if `path` doesn't exist.
 */
export function backupPath(ctx: Context, path: string, { move = false } = {}): string | null {
  const stat = lstatOrUndefined(path);
  if (!stat) return null;
  const dest = backupPathFor(ctx, path);
  mkdirSync(dirname(dest), { recursive: true });
  if (move) {
    try {
      renameSync(path, dest);
    } catch {
      // Different filesystem: copy, then remove.
      cpSync(path, dest, { recursive: true, verbatimSymlinks: true });
      rmSync(path, { recursive: true, force: true });
    }
  } else {
    cpSync(path, dest, { recursive: true, verbatimSymlinks: true });
  }
  ctx.log.info(`backed up ${tildify(path)} → ${tildify(dest)}`);
  return dest;
}

// ---------------------------------------------------------------------------
// symlink: the repo owns the file; the target just points at it.
// ---------------------------------------------------------------------------

/**
 * Point `target` at `source` (absolute paths). Anything already at `target`
 * that isn't our symlink is moved into the backup folder first.
 */
export function symlinkWithBackup(ctx: Context, source: string, target: string): FileChange {
  const stat = lstatOrUndefined(target);
  if (stat?.isSymbolicLink() && resolve(dirname(target), readlinkSync(target)) === resolve(source)) {
    return 'unchanged';
  }
  if (stat) backupPath(ctx, target, { move: true });
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target);
  ctx.log.info(`linked ${tildify(target)} → ${tildify(source)}`);
  return stat ? 'updated' : 'created';
}

// ---------------------------------------------------------------------------
// seed: copy a starting point once; afterwards the file belongs to the user.
// ---------------------------------------------------------------------------

export function seedFile(ctx: Context, source: string, target: string): FileChange {
  if (lstatOrUndefined(target)) return 'unchanged';
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  ctx.log.info(`seeded ${tildify(target)} from ${tildify(source)}`);
  return 'created';
}

// ---------------------------------------------------------------------------
// merge: the tool owns the file and writes to it; we enforce our keys.
// ---------------------------------------------------------------------------

export interface MergeSources {
  /** The shipped file in config/ (must exist). */
  base: string;
  /** Optional private overlays, e.g. ~/.zaun-local/claude/settings.json. Missing files are skipped. */
  overlays?: string[];
}

interface Format {
  parse(text: string): PlainObject;
  stringify(value: PlainObject): string;
}

const json: Format = {
  parse: (text) => (text.trim() === '' ? {} : (JSON.parse(text) as PlainObject)),
  stringify: (value) => JSON.stringify(value, null, 2) + '\n',
};

const toml: Format = {
  parse: (text) => parseToml(text) as PlainObject,
  stringify: (value) => stringifyToml(value) + '\n',
};

function readLayer(format: Format, path: string): PlainObject {
  let value: unknown;
  try {
    value = format.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${tildify(path)}: ${(err as Error).message}`);
  }
  if (!isPlainObject(value)) throw new Error(`${tildify(path)} must contain an object at the top level`);
  return value;
}

export type MergeFormat = 'json' | 'toml';
const formats: Record<MergeFormat, Format> = { json, toml };

/** existing target (read through a symlink) + base + the overlays that exist, merged. */
function computeMerge(format: Format, target: string, sources: MergeSources) {
  const stat = lstatOrUndefined(target);
  const isSymlink = stat?.isSymbolicLink() ?? false;
  const existing = stat && existsSync(target) ? readLayer(format, target) : {};
  const layers = [
    readLayer(format, sources.base),
    ...(sources.overlays ?? []).filter((p) => existsSync(p)).map((p) => readLayer(format, p)),
  ];
  return { stat, isSymlink, existing, merged: deepMerge<PlainObject>(existing, ...layers) };
}

function mergeFile(ctx: Context, format: Format, target: string, sources: MergeSources): FileChange {
  // Read through a symlink (keeps the user's settings), but write a real file:
  // writing through the link would change a file that zaun doesn't own.
  const { stat, isSymlink, merged } = computeMerge(format, target, sources);
  const output = format.stringify(merged);

  if (stat && !isSymlink && readFileSync(target, 'utf8') === output) return 'unchanged';
  // Keep the mode of the file a symlink points to: once the link is moved to
  // the backup folder, writeFileAtomic can no longer see it.
  const linkedMode = isSymlink && existsSync(target) ? statSync(target).mode & 0o777 : undefined;
  if (stat) backupPath(ctx, target, { move: isSymlink });
  writeFileAtomic(target, output, linkedMode);
  ctx.log.info(`merged ${tildify(target)}`);
  return stat ? 'updated' : 'created';
}

export interface MergeDrift {
  /** The target exists (a dangling symlink counts as missing). */
  exists: boolean;
  /** The target is a symlink; a merge would replace it with a real file. */
  isSymlink: boolean;
  /** Top-level keys whose value the merge would change or add. [] = up to date. */
  drift: string[];
}

/**
 * Dry run of mergeJsonFile / mergeTomlFile: what would change, without writing.
 * Read-only, so it's safe in `check()` and `isInstalled()`. Up to date means
 * `exists && !isSymlink && drift.length === 0`. Throws if a file can't be parsed.
 */
export function mergeDrift(target: string, sources: MergeSources, format: MergeFormat): MergeDrift {
  const { isSymlink, existing, merged } = computeMerge(formats[format], target, sources);
  // structuredClone normalises prototypes (TOML tables, Dates) so only the data is compared.
  const drift = Object.keys(merged).filter(
    (k) => !isDeepStrictEqual(structuredClone(merged[k]), structuredClone(existing[k])),
  );
  return { exists: existsSync(target), isSymlink, drift };
}

/** result = deepMerge(existing target, base, ...overlays), written as pretty JSON. */
export function mergeJsonFile(ctx: Context, target: string, sources: MergeSources): FileChange {
  return mergeFile(ctx, json, target, sources);
}

/** Same as mergeJsonFile for TOML. Note: comments in the target are not preserved. */
export function mergeTomlFile(ctx: Context, target: string, sources: MergeSources): FileChange {
  return mergeFile(ctx, toml, target, sources);
}

export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// managed block: our lines inside a file the user also edits (~/.zshrc).
// ---------------------------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pure function: insert or replace
 *
 *   # >>> zaun >>>
 *   <body>
 *   # <<< zaun <<<
 *
 * in `content`. Replaced in place if present, appended (after a blank line) otherwise.
 */
export function upsertBlock(content: string, body: string, name = 'zaun', comment = '#'): string {
  const start = `${comment} >>> ${name} >>>`;
  const end = `${comment} <<< ${name} <<<`;
  const block = [
    start,
    `${comment} Managed by zaun: edits inside this block are overwritten on the next install.`,
    body.replace(/\n+$/, ''),
    end,
  ].join('\n');

  const pattern = new RegExp(`^${escape(start)}\\n[\\s\\S]*?^${escape(end)}$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, () => block);

  if (content === '') return block + '\n';
  const base = content.endsWith('\n') ? content : content + '\n';
  return `${base}\n${block}\n`;
}

/** Apply `upsertBlock` to a file (created if missing). Backs up the file before changing it. */
export function upsertManagedBlock(
  ctx: Context,
  file: string,
  body: string,
  opts: { name?: string; comment?: string } = {},
): FileChange {
  const exists = existsSync(file);
  const before = exists ? readFileSync(file, 'utf8') : '';
  const after = upsertBlock(before, body, opts.name, opts.comment);
  if (after === before) return 'unchanged';
  if (exists) backupPath(ctx, file);
  else mkdirSync(dirname(file), { recursive: true });
  // Write through symlinks on purpose: a dotfiles-managed ~/.zshrc stays a symlink.
  writeFileSync(file, after);
  ctx.log.info(`updated managed block in ${tildify(file)}`);
  return exists ? 'updated' : 'created';
}
