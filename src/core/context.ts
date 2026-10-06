// Runs module commands. Output goes to the log file, so the terminal only shows spinners.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { Context, Env, Options, RunOptions, RunResult } from './types.ts';
import { ZAUN_DIR, localDir, timestamp } from './paths.ts';

/** Thrown by `ctx.run` on a non-zero exit. `message` contains the last lines of output. */
export class RunError extends Error {
  readonly code: number | null;
  readonly tail: string;
  constructor(cmd: string, code: number | null, tail: string) {
    const how = code === null ? 'was killed (timeout or signal)' : `exited with code ${code}`;
    super(`Command ${how}: ${cmd}${tail ? `\n${tail}` : ''}`);
    this.name = 'RunError';
    this.code = code;
    this.tail = tail;
  }
}

export class NotImplementedError extends Error {
  constructor(moduleId: string) {
    super(`Module "${moduleId}" is not implemented yet.`);
    this.name = 'NotImplementedError';
  }
}

const TAIL_LINES = 15;

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface CreateContextOptions {
  env: Env;
  options: Options;
  withLogFile: boolean;
}

export interface RunnerContext extends Context {
  /** Set by the installer: receives progress messages and collected warnings for the current module. */
  onProgress: ((message: string) => void) | null;
  warnings: string[];
}

export function createContext({ env, options, withLogFile }: CreateContextOptions): RunnerContext {
  const home = homedir();
  const local = localDir();
  const stamp = timestamp();
  const logFile = withLogFile ? join(local, 'logs', `install-${stamp}.log`) : null;
  if (logFile) {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `# zaun install log, started ${new Date().toISOString()}\n`);
  }

  const write = (line: string) => {
    if (logFile) appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n');
  };

  // Tools installed by zaun land in ~/.local/bin; make sure later modules
  // (and checks) find them even if the user's shell hasn't been reloaded yet.
  const addPath = (dir: string) => {
    const parts = (process.env.PATH ?? '').split(delimiter);
    if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(delimiter);
  };
  addPath(join(home, '.local', 'bin'));

  const baseEnv = (): Record<string, string> => ({
    ...(process.env as Record<string, string>),
    ZAUN_DIR,
    ZAUN_LOCAL_DIR: local,
    // apt and friends must never wait for input: stdin is not a terminal here.
    DEBIAN_FRONTEND: 'noninteractive',
  });

  const exec = (cmd: string, opts: RunOptions = {}): Promise<RunResult> => {
    const env = { ...baseEnv(), ...opts.env };
    let file = 'bash';
    let args = ['-c', cmd];
    if (opts.sudo) {
      // -n: never prompt (passwordless, or the ticket was primed by primeSudo() up front).
      // `env K=V` because sudo resets the environment by default.
      const extra = Object.entries({ DEBIAN_FRONTEND: 'noninteractive', ...opts.env }).map(
        ([k, v]) => `${k}=${v}`,
      );
      file = 'sudo';
      args = ['-n', 'env', ...extra, 'bash', '-c', cmd];
    }

    write(`\n$ ${opts.sudo ? 'sudo ' : ''}${cmd}${opts.cwd ? `   (in ${opts.cwd})` : ''}`);

    return new Promise((resolve) => {
      const child = spawn(file, args, {
        cwd: opts.cwd,
        env,
        // stdin is ignored on purpose: an installer that asks a question
        // should fail loudly instead of hanging behind a spinner.
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: opts.timeoutMs,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk;
        write(chunk.toString());
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk;
        write(chunk.toString());
      });
      child.on('error', (err) => {
        stderr += String(err);
        resolve({ ok: false, code: null, stdout, stderr });
      });
      child.on('close', (code) => {
        write(`[exit ${code ?? 'signal'}]`);
        resolve({ ok: code === 0, code, stdout, stderr });
      });
    });
  };

  const run = async (cmd: string, opts?: RunOptions): Promise<string> => {
    const result = await exec(cmd, opts);
    if (!result.ok) {
      const tail = (result.stdout + '\n' + result.stderr)
        .split('\n')
        .filter((l) => l.trim() !== '')
        .slice(-TAIL_LINES)
        .join('\n');
      throw new RunError(cmd, result.code, tail);
    }
    return result.stdout.trim();
  };

  const ctx: RunnerContext = {
    paths: {
      home,
      zaunDir: ZAUN_DIR,
      configDir: join(ZAUN_DIR, 'config'),
      localDir: local,
      backupDir: join(local, 'backups', stamp),
      logFile,
    },
    env,
    options,
    onProgress: null,
    warnings: [],
    log: {
      info: (message) => write(`[info] ${message}`),
      warn: (message) => {
        write(`[warn] ${message}`);
        ctx.warnings.push(message);
      },
    },
    run,
    tryRun: exec,
    runScript: (moduleId, args = [], opts) => {
      const script = join(ZAUN_DIR, 'modules', moduleId, 'install.sh');
      return run(['bash', script, ...args].map(shellQuote).join(' '), opts);
    },
    exists: async (cmd) => (await exec(`command -v ${shellQuote(cmd)}`)).ok,
    addPath,
    progress: (message) => {
      write(`[progress] ${message}`);
      ctx.onProgress?.(message);
    },
  };
  return ctx;
}

let keepAlive: NodeJS.Timeout | undefined;

/** Prompts for the sudo password (if needed) on the real terminal. Returns false if it failed. */
export function primeSudo(): boolean {
  // Passwordless sudo needs no ticket. Checked with `sudo -n true`, not `sudo -v`: -v prompts
  // unless every matching sudoers rule is NOPASSWD (OrbStack has NOPASSWD plus the sudo group).
  if (spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0) return true;
  const result = spawnSync('sudo', ['-v'], { stdio: 'inherit' });
  if (result.status !== 0) return false;
  // Refresh every 60s so long installs never hit the 15-minute sudo timeout.
  keepAlive = setInterval(() => spawnSync('sudo', ['-n', '-v'], { stdio: 'ignore' }), 60_000);
  keepAlive.unref();
  return true;
}

export function stopSudoKeepAlive(): void {
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = undefined;
}
