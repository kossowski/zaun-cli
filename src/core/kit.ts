// Everything a module needs, from one import:
//
//   import { defineModule, symlinkWithBackup } from '../../src/core/kit.ts';
//
// Keep modules depending on this file only, so the core can be reorganised freely.

import type { CheckResult, Module } from './types.ts';

export type {
  CheckResult,
  CheckStatus,
  Context,
  Env,
  Group,
  Module,
  Options,
  Paths,
  RunOptions,
  RunResult,
} from './types.ts';
export { NotImplementedError, RunError, shellQuote } from './context.ts';
export { deepMerge, isPlainObject } from './merge.ts';
export {
  backupPath,
  mergeDrift,
  mergeJsonFile,
  mergeTomlFile,
  readJsonFile,
  seedFile,
  symlinkWithBackup,
  upsertBlock,
  upsertManagedBlock,
  writeFileAtomic,
  type FileChange,
  type MergeDrift,
  type MergeFormat,
  type MergeSources,
} from './files.ts';
export { tildify } from './paths.ts';

/** Identity function that gives a module object full type checking and editor hints. */
export function defineModule(mod: Module): Module {
  return mod;
}

export function notImplementedCheck(label: string): CheckResult {
  return { status: 'warn', label, detail: 'check not implemented yet' };
}

export function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}
