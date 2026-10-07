import { describe, expect, it } from 'vitest';
import { DependencyError, resolvePlan } from '../src/core/order.ts';
import { modules } from '../src/core/registry.ts';

const mods = [
  { id: 'base' },
  { id: 'docker', deps: ['base'] },
  { id: 'node', deps: ['base'] },
  { id: 'claude-code', deps: ['base'] },
  { id: 'tooling', deps: ['node', 'claude-code'] },
];
const ids = (plan: { ordered: { id: string }[] }) => plan.ordered.map((m) => m.id);

describe('resolvePlan', () => {
  it('adds missing dependencies and reports them', () => {
    const plan = resolvePlan(['tooling'], mods);
    expect(ids(plan)).toEqual(['base', 'node', 'claude-code', 'tooling']);
    expect(plan.added).toEqual(['base', 'node', 'claude-code']);
  });

  it('keeps registry order regardless of selection order', () => {
    expect(ids(resolvePlan(['docker', 'base'], mods))).toEqual(['base', 'docker']);
    expect(resolvePlan(['docker', 'base'], mods).added).toEqual([]);
  });

  it('puts dependencies first even when the registry lists them later', () => {
    const reversed = [{ id: 'app', deps: ['lib'] }, { id: 'lib' }];
    expect(ids(resolvePlan(['app'], reversed))).toEqual(['lib', 'app']);
  });

  it('includes each module once', () => {
    expect(ids(resolvePlan(['tooling', 'node', 'base'], mods))).toEqual(['base', 'node', 'claude-code', 'tooling']);
  });

  it('detects cycles', () => {
    const cyclic = [{ id: 'a', deps: ['c'] }, { id: 'b', deps: ['a'] }, { id: 'c', deps: ['b'] }];
    expect(() => resolvePlan(['a'], cyclic)).toThrow(DependencyError);
    expect(() => resolvePlan(['a'], cyclic)).toThrow(/a → c → b → a/);
  });

  it('rejects unknown modules and unknown dependencies', () => {
    expect(() => resolvePlan(['nope'], mods)).toThrow(/Unknown module "nope"/);
    expect(() => resolvePlan(['x'], [{ id: 'x', deps: ['ghost'] }])).toThrow(/"x" depends on unknown module "ghost"/);
  });

  it('the real registry has no cycles or dangling deps', () => {
    const plan = resolvePlan(modules.map((m) => m.id), modules);
    expect(plan.ordered).toHaveLength(15);
    expect(plan.ordered[0]!.id).toBe('base');
  });
});
