// The module contract. Every folder in `modules/<id>/` exports one `Module`.
// Read docs/architecture.md for the full picture.

export type Group = 'system' | 'shell' | 'runtimes' | 'agents' | 'config';

/** `warn` = installed, but the user still has to do something (log in, re-login, add a token). */
export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  status: CheckStatus;
  /** Short, e.g. "Docker 27.3.1" or "gh logged in". */
  label: string;
  /** Optional extra info shown dimmed next to the label. */
  detail?: string;
  /** What the user should do about a warn/fail, e.g. "run `gh auth login`". */
  hint?: string;
}

export interface Module {
  /** Fixed identifier, also the folder name under `modules/`. */
  id: string;
  name: string;
  group: Group;
  /** One line, shown as a hint in the menu. */
  description: string;
  /** Ids that must be installed first. They are auto-included when this module is selected. */
  deps?: string[];
  /** Needs root to install. zaun asks for the sudo password once, before running anything. */
  sudo?: boolean;
  /** Preselected in the menu when there is no previous selection in state.json. */
  defaultSelected?: boolean;

  /** Fast and read-only. Marks "installed" in the menu. */
  isInstalled(ctx: Context): Promise<boolean>;
  /** Must be idempotent: running it twice is safe and the second run changes nothing. */
  install(ctx: Context): Promise<void>;
  /** READ-ONLY health check, no side effects. May return several results. */
  check(ctx: Context): Promise<CheckResult[]>;
  /**
   * Shown in the final summary, e.g. "Run `claude` to log in". May be async to
   * check something first (read-only), so it only shows what's actually left to do.
   * Don't add "open a new terminal": zaun adds that once at the end.
   */
  nextSteps?(ctx: Context): string[] | Promise<string[]>;
}

export interface RunOptions {
  /** Run as root via `sudo -n` (the sudo ticket is refreshed in the background). */
  sudo?: boolean;
  cwd?: string;
  /** Extra environment variables (merged over the current environment). */
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface RunResult {
  ok: boolean;
  /** Exit code, or null if killed by a signal / timeout. */
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Env {
  /** Debian architecture name: `arm64`, `amd64`, ... */
  arch: string;
  /** `uname -m`: `aarch64`, `x86_64`, ... */
  machine: string;
  /** From /etc/os-release. */
  os: {
    /** `ID`, e.g. "ubuntu", "debian"; "" if unknown. */
    id: string;
    /** `VERSION_ID`, e.g. "24.04", "12"; null if absent. */
    versionId: string | null;
    /** `PRETTY_NAME`, e.g. "Ubuntu 24.04.1 LTS"; falls back to "Linux". */
    prettyName: string;
    /** ID or ID_LIKE contains "debian" (Ubuntu, Debian, Mint, ...): apt-based. */
    debianFamily: boolean;
  };
  user: string;
  isRoot: boolean;
  isOrbStack: boolean;
  /** OrbStack only: the machine can't see or reach the Mac. null when not on OrbStack. */
  isIsolated: boolean | null;
}

export interface Paths {
  home: string;
  /** Repository root (where `modules/` and `config/` live), usually ~/.zaun. */
  zaunDir: string;
  /** Shipped public config: `<zaunDir>/config`. */
  configDir: string;
  /** Private overlay + state: ~/.zaun-local. Never inside the repo. */
  localDir: string;
  /** Backups for this run: ~/.zaun-local/backups/<timestamp>. Created lazily. */
  backupDir: string;
  /** Log file for this run, or null (doctor does not write a log). */
  logFile: string | null;
}

/** Values collected from prompts / flags / state.json. */
export interface Options {
  gitName?: string;
  gitEmail?: string;
  /** true when running with --yes (no prompts allowed). */
  nonInteractive: boolean;
}

export interface Logger {
  /** Written to the log file only. */
  info(message: string): void;
  /** Written to the log file and shown to the user after the module finishes. */
  warn(message: string): void;
}

export interface Context {
  paths: Paths;
  env: Env;
  options: Options;
  log: Logger;

  /**
   * Run a command with `bash -c`. Output goes to the log file. Returns trimmed stdout.
   * Throws a `RunError` (with the last lines of output) on a non-zero exit.
   */
  run(cmd: string, opts?: RunOptions): Promise<string>;
  /** Like `run`, but never throws. Use it in `check()` and `isInstalled()`. */
  tryRun(cmd: string, opts?: RunOptions): Promise<RunResult>;
  /** Run `modules/<moduleId>/install.sh [args]` as the current user (the script uses sudo itself). */
  runScript(moduleId: string, args?: string[], opts?: RunOptions): Promise<string>;
  exists(cmd: string): Promise<boolean>;
  /**
   * Prepend a directory to PATH for this process and every later command,
   * e.g. after installing into ~/.local/bin or after fnm installed Node.
   */
  addPath(dir: string): void;
  /** Update the spinner text while a module installs, e.g. "downloading…". */
  progress(message: string): void;
}
