// ~/.zaun-local/state.json: what the user picked last time, so the next
// `zaun install` preselects it and `zaun doctor` knows what to check.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './files.ts';
import { localDir } from './paths.ts';

export type OverlayChoice =
  | { kind: 'none' }
  | { kind: 'local' } // the user maintains ~/.zaun-local by hand
  | { kind: 'git'; url: string }; // ~/.zaun-local was cloned from this URL

export interface State {
  version: 1;
  /** Module ids the user selected (without auto-added deps). */
  selected: string[];
  /** When each module was last installed successfully (ISO timestamps). */
  installed: Record<string, string>;
  git?: { name: string; email: string };
  overlay?: OverlayChoice;
  lastRun?: string;
}

export function statePath(): string {
  return join(localDir(), 'state.json');
}

export function emptyState(): State {
  return { version: 1, selected: [], installed: {} };
}

/** Returns null if there is no state yet (first run). Throws on a corrupt file. */
export function readState(): State | null {
  const path = statePath();
  if (!existsSync(path)) return null;
  try {
    return { ...emptyState(), ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<State>) };
  } catch (err) {
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }
}

export function writeState(state: State): void {
  writeFileAtomic(statePath(), JSON.stringify(state, null, 2) + '\n');
}
