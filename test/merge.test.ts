import { describe, expect, it } from 'vitest';
import { deepMerge } from '../src/core/merge.ts';

describe('deepMerge', () => {
  it('merges objects recursively and lets later scalars win', () => {
    const existing = { model: 'a', ui: { theme: 'dark', font: 12 } };
    const base = { model: 'b', ui: { font: 14 } };
    expect(deepMerge(existing, base)).toEqual({ model: 'b', ui: { theme: 'dark', font: 14 } });
  });

  it('keeps keys only the existing file has (tool-owned settings survive)', () => {
    const existing = { autoMode: { enabled: true }, theme: 'dark' };
    const base = { statusLine: { type: 'command' } };
    expect(deepMerge(existing, base)).toEqual({
      autoMode: { enabled: true },
      theme: 'dark',
      statusLine: { type: 'command' },
    });
  });

  it('concatenates arrays and removes duplicates, including objects', () => {
    const existing = { allow: ['Bash(ls)', 'Read'], hooks: [{ cmd: 'a', n: 1 }] };
    const base = { allow: ['Read', 'Edit'], hooks: [{ n: 1, cmd: 'a' }, { cmd: 'b' }] };
    expect(deepMerge(existing, base)).toEqual({
      allow: ['Bash(ls)', 'Read', 'Edit'],
      hooks: [{ cmd: 'a', n: 1 }, { cmd: 'b' }],
    });
  });

  it('applies three layers left to right: existing, base, overlay', () => {
    const result = deepMerge({ a: 1, list: [1] }, { a: 2, b: 2, list: [2] }, { b: 3, list: [1, 3] });
    expect(result).toEqual({ a: 2, b: 3, list: [1, 2, 3] });
  });

  it('lets a later scalar replace an object and vice versa', () => {
    expect(deepMerge({ x: { y: 1 } }, { x: false })).toEqual({ x: false });
    expect(deepMerge({ x: 'off' }, { x: { y: 1 } })).toEqual({ x: { y: 1 } });
  });

  it('treats undefined in a later layer as "not set"', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });

  it('keeps 1 and "1" apart when de-duplicating arrays', () => {
    expect(deepMerge({ l: [1] }, { l: ['1'] })).toEqual({ l: [1, '1'] });
  });

  it('never mutates its inputs', () => {
    const a = { o: { k: [1] } };
    const b = { o: { k: [2], j: true } };
    const snapshot = JSON.stringify([a, b]);
    deepMerge(a, b);
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });

  it('ignores __proto__ keys from parsed files', () => {
    const evil = JSON.parse('{"__proto__": {"polluted": true}}');
    const result = deepMerge({}, evil) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.polluted).toBeUndefined();
  });
});
