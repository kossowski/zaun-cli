import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { CheckResult, CheckStatus, Env, Group } from './types.ts';

export const symbols: Record<CheckStatus, string> = {
  ok: pc.green('✓'),
  warn: pc.yellow('⚠'),
  fail: pc.red('✗'),
};

export const groupLabels: Record<Group, string> = {
  system: 'System',
  shell: 'Shell',
  runtimes: 'Runtimes',
  agents: 'AI agents',
  config: 'Agent & tool config',
};

export const groupOrder: Group[] = ['system', 'shell', 'runtimes', 'agents', 'config'];

export function title(subtitle: string): string {
  return `${pc.bgCyan(pc.black(' zaun '))} ${pc.dim(subtitle)}`;
}

export const code = (s: string) => pc.cyan(s);

/** Render `backtick` spans (as written in hints and next steps) in cyan. */
export function inlineCode(text: string): string {
  return text.replace(/`([^`]+)`/g, (_, inner: string) => code(inner));
}

/** One line describing where we are: Ubuntu 24.04.1 LTS · arm64 · dev · OrbStack isolated ✓ */
export function envLine(env: Env): string {
  const parts = [
    env.os.debianFamily ? env.os.prettyName : pc.yellow(env.os.prettyName),
    env.arch,
    env.user,
  ];
  if (env.isOrbStack) {
    parts.push(env.isIsolated ? `OrbStack isolated ${symbols.ok}` : `OrbStack isolated ${symbols.fail}`);
  }
  return parts.join(pc.dim(' · '));
}

/** "✓ Docker 27.3   detail" + an indented hint line for warn/fail. */
export function formatCheck(result: CheckResult): string {
  const detail = result.detail ? `  ${pc.dim(result.detail)}` : '';
  const hint =
    result.hint && result.status !== 'ok' ? `\n  ${pc.dim('→')} ${inlineCode(result.hint)}` : '';
  return `${symbols[result.status]} ${inlineCode(result.label)}${detail}${hint}`;
}

/** Summary like "12 ok · 2 warnings · 1 failed". */
export function countLine(results: CheckResult[]): string {
  const n = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  const parts = [pc.green(`${n('ok')} ok`)];
  if (n('warn')) parts.push(pc.yellow(`${n('warn')} warning${n('warn') === 1 ? '' : 's'}`));
  if (n('fail')) parts.push(pc.red(`${n('fail')} failed`));
  return parts.join(pc.dim(' · '));
}

/**
 * Unwrap a clack prompt result. On Ctrl+C / Escape, print a friendly message
 * and exit. The default message assumes nothing has been changed yet; pass
 * `message` for prompts that come after some work was already done.
 */
export function orExit<T>(value: T, message = 'Cancelled. Nothing was changed.'): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel(message);
    process.exit(130);
  }
  return value as Exclude<T, symbol>;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Loose check, just enough to catch typos like a missing @. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value);
}
