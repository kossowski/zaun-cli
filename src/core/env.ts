import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import type { Env } from './types.ts';

/** Parse the KEY=value lines of /etc/os-release (values may be quoted). */
export function parseOsRelease(text: string): Env['os'] {
  const entries = text
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)=(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1]!, m[2]!.trim().replace(/^(["'])(.*)\1$/, '$2')] as const);
  const fields: Record<string, string> = Object.fromEntries(entries);
  const id = fields.ID ?? '';
  // ID_LIKE is a space-separated list, e.g. "ubuntu debian" on Linux Mint.
  const family = [id, ...(fields.ID_LIKE ?? '').split(/\s+/)];
  return {
    id,
    versionId: fields.VERSION_ID || null,
    prettyName: fields.PRETTY_NAME || 'Linux',
    debianFamily: family.includes('debian'),
  };
}

function osRelease(): Env['os'] {
  try {
    return parseOsRelease(readFileSync('/etc/os-release', 'utf8'));
  } catch {
    return parseOsRelease('');
  }
}

function debianArch(): string {
  try {
    return execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim();
  } catch {
    return process.arch === 'x64' ? 'amd64' : process.arch;
  }
}

function machine(): string {
  try {
    return execFileSync('uname', ['-m'], { encoding: 'utf8' }).trim();
  } catch {
    return process.arch;
  }
}

/** Not the kernel name: Docker containers on OrbStack contain "orbstack" too. */
export function detectOrbStack(): boolean {
  return existsSync('/opt/orbstack-guest');
}

function canRead(dir: string): boolean {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

export interface IsolationReport {
  macMount: boolean;
  /** /Users holds the Mac home folders. */
  usersMount: boolean;
  macCommand: boolean;
}

/** `/usr/local/bin/mac` exists even on an isolated machine, so actually run it. */
export async function probeIsolation(): Promise<IsolationReport> {
  const macCommand = await new Promise<boolean>((resolve) => {
    execFile('mac', ['true'], { timeout: 3000 }, (err) => resolve(!err));
  });
  return { macMount: canRead('/mnt/mac'), usersMount: canRead('/Users'), macCommand };
}

export function isIsolated(report: IsolationReport): boolean {
  return !report.macMount && !report.usersMount && !report.macCommand;
}

export async function detectEnv(): Promise<Env> {
  const isOrbStack = detectOrbStack();
  const user = userInfo();
  return {
    arch: debianArch(),
    machine: machine(),
    os: osRelease(),
    user: user.username,
    isRoot: user.uid === 0,
    isOrbStack,
    isIsolated: isOrbStack ? isIsolated(await probeIsolation()) : null,
  };
}
