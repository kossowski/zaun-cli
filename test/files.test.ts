// The file helpers against a throwaway directory (never the real $HOME).
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mergeDrift, mergeJsonFile, mergeTomlFile, seedFile, symlinkWithBackup, upsertManagedBlock, writeFileAtomic } from '../src/core/files.ts';
import type { Context } from '../src/core/types.ts';

let home: string;
let ctx: Context;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'zaun-test-'));
  ctx = {
    paths: { home, backupDir: join(home, '.zaun-local/backups/now') },
    log: { info: () => {}, warn: () => {} },
  } as unknown as Context;
});

const write = (rel: string, content: string) => {
  const path = join(home, rel);
  writeFileSync(path, content);
  return path;
};

describe('writeFileAtomic permissions', () => {
  it.each([0o600, 0o640, 0o755])('preserves existing mode %i', (mode) => {
    const target = write('private.json', '{}');
    chmodSync(target, mode);
    writeFileAtomic(target, '{"updated":true}');
    expect(statSync(target).mode & 0o777).toBe(mode);
    expect(readFileSync(target, 'utf8')).toBe('{"updated":true}');
  });

  it('creates new files with owner-only permissions', () => {
    const target = join(home, 'new.json');
    writeFileAtomic(target, '{}');
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('keeps private config permissions during a merge', () => {
    const target = write('private.json', '{"token":"fixture"}');
    chmodSync(target, 0o600);
    const base = write('base.json', '{"theme":"dark"}');
    mergeJsonFile(ctx, target, { base });
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});

describe('symlinkWithBackup', () => {
  it('links, backs up a foreign file, and is idempotent', () => {
    const source = write('source.toml', 'x = 1');
    const target = write('target.toml', 'mine');
    expect(symlinkWithBackup(ctx, source, target)).toBe('updated');
    expect(readlinkSync(target)).toBe(source);
    expect(readFileSync(join(home, '.zaun-local/backups/now/target.toml'), 'utf8')).toBe('mine');
    expect(symlinkWithBackup(ctx, source, target)).toBe('unchanged');
  });

  it('creates missing parent directories', () => {
    const source = write('s', '');
    expect(symlinkWithBackup(ctx, source, join(home, 'a/b/c'))).toBe('created');
  });
});

describe('seedFile', () => {
  it('copies only when the target is missing', () => {
    const source = write('seed', 'v1');
    const target = join(home, 'cfg/seeded');
    expect(seedFile(ctx, source, target)).toBe('created');
    writeFileSync(target, 'user edit');
    expect(seedFile(ctx, source, target)).toBe('unchanged');
    expect(readFileSync(target, 'utf8')).toBe('user edit');
  });
});

describe('mergeJsonFile', () => {
  it('merges existing + base + overlay, backs up, and is idempotent', () => {
    const target = write('settings.json', JSON.stringify({ autoMode: { on: true }, perms: ['a'] }));
    const base = write('base.json', JSON.stringify({ perms: ['b'], theme: 'dark' }));
    const overlay = write('overlay.json', JSON.stringify({ theme: 'light' }));
    const missing = join(home, 'missing.json');

    expect(mergeJsonFile(ctx, target, { base, overlays: [overlay, missing] })).toBe('updated');
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({
      autoMode: { on: true },
      perms: ['a', 'b'],
      theme: 'light',
    });
    expect(existsSync(join(home, '.zaun-local/backups/now/settings.json'))).toBe(true);
    expect(mergeJsonFile(ctx, target, { base, overlays: [overlay] })).toBe('unchanged');
  });

  it('replaces a symlinked target with a real file, keeping its contents', () => {
    const real = write('dotfiles.json', JSON.stringify({ keep: 1 }));
    const target = join(home, 'linked.json');
    symlinkSync(real, target);
    const base = write('base.json', JSON.stringify({ add: 2 }));
    mergeJsonFile(ctx, target, { base });
    expect(lstatSync(target).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ keep: 1, add: 2 });
    expect(JSON.parse(readFileSync(real, 'utf8'))).toEqual({ keep: 1 });
  });

  it('keeps the mode of the file a symlinked target points to', () => {
    const real = write('dotfiles.json', JSON.stringify({ keep: 1 }));
    chmodSync(real, 0o644);
    const target = join(home, 'linked.json');
    symlinkSync(real, target);
    const base = write('base.json', JSON.stringify({ add: 2 }));
    mergeJsonFile(ctx, target, { base });
    expect(lstatSync(target).isFile()).toBe(true);
    expect(lstatSync(target).mode & 0o777).toBe(0o644);
  });

  it('leaves no temp files next to the target, also when the rename fails', () => {
    const target = write('settings.json', '{}');
    const base = write('base.json', JSON.stringify({ add: 2 }));
    mergeJsonFile(ctx, target, { base });
    const blocked = join(home, 'dir');
    mkdirSync(join(blocked, 'child'), { recursive: true });
    expect(() => writeFileAtomic(blocked, '{}')).toThrow();
    expect(readdirSync(home).filter((f) => f.includes('zaun-tmp'))).toEqual([]);
  });

  it('reports which file is broken', () => {
    const target = write('bad.json', '{ nope');
    const base = write('base.json', '{}');
    expect(() => mergeJsonFile(ctx, target, { base })).toThrow(/Could not parse .*bad\.json/);
  });
});

describe('mergeTomlFile', () => {
  it('merges tables', () => {
    const target = write('config.toml', 'model = "x"\n[projects."/tmp/p"]\ntrust_level = "trusted"\n');
    const base = write('base.toml', 'model = "y"\n[tui]\nnotifications = true\n');
    mergeTomlFile(ctx, target, { base });
    const text = readFileSync(target, 'utf8');
    expect(text).toContain('model = "y"');
    expect(text).toContain('trust_level = "trusted"');
    expect(text).toContain('notifications = true');
  });
});

describe('mergeDrift', () => {
  it('reports a missing target, then nothing after the merge (JSON)', () => {
    const target = join(home, 'settings.json');
    const base = write('base.json', JSON.stringify({ theme: 'dark', perms: ['a'] }));
    expect(mergeDrift(target, { base }, 'json')).toEqual({ exists: false, isSymlink: false, drift: ['theme', 'perms'] });
    mergeJsonFile(ctx, target, { base });
    expect(mergeDrift(target, { base }, 'json')).toEqual({ exists: true, isSymlink: false, drift: [] });
  });

  it('lists only the top-level keys the merge would change, and never writes', () => {
    const before = JSON.stringify({ theme: 'dark', perms: ['a', 'b'], mine: 1 });
    const target = write('settings.json', before);
    const base = write('base.json', JSON.stringify({ theme: 'dark', perms: ['b'] }));
    const overlay = write('overlay.json', JSON.stringify({ perms: ['c'], extra: { x: 1 } }));
    const missing = join(home, 'missing.json');
    const result = mergeDrift(target, { base, overlays: [overlay, missing] }, 'json');
    expect(result.drift).toEqual(['perms', 'extra']);
    expect(readFileSync(target, 'utf8')).toBe(before);
  });

  it('flags a symlinked target even when its content is up to date', () => {
    const real = write('real.json', JSON.stringify({ theme: 'dark' }));
    const target = join(home, 'settings.json');
    symlinkSync(real, target);
    const base = write('base.json', JSON.stringify({ theme: 'dark' }));
    expect(mergeDrift(target, { base }, 'json')).toEqual({ exists: true, isSymlink: true, drift: [] });
  });

  it('compares TOML tables and dates by value', () => {
    const target = write('config.toml', 'model = "a"\nwhen = 2024-01-01T00:00:00Z\n[projects."/x"]\ntrust_level = "trusted"\n');
    const base = write('base.toml', 'model = "a"\n[tui]\nnotifications = true\n');
    expect(mergeDrift(target, { base }, 'toml').drift).toEqual(['tui']);
    mergeTomlFile(ctx, target, { base });
    expect(mergeDrift(target, { base }, 'toml').drift).toEqual([]);
  });

  it('throws with the file name on a parse error', () => {
    const target = write('broken.json', '{ nope');
    const base = write('base.json', '{}');
    expect(() => mergeDrift(target, { base }, 'json')).toThrow(/broken\.json/);
  });
});

describe('upsertManagedBlock', () => {
  it('creates, then leaves an up-to-date file alone', () => {
    const file = join(home, 'zsh/.zshrc');
    expect(upsertManagedBlock(ctx, file, 'source x')).toBe('created');
    expect(upsertManagedBlock(ctx, file, 'source x')).toBe('unchanged');
    expect(upsertManagedBlock(ctx, file, 'source y')).toBe('updated');
  });
});
