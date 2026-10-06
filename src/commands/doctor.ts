import * as p from '@clack/prompts';
import pc from 'picocolors';
import { createContext } from '../core/context.ts';
import { detectEnv, probeIsolation } from '../core/env.ts';
import { resolvePlan } from '../core/order.ts';
import { byGroup, modules } from '../core/registry.ts';
import { readState } from '../core/state.ts';
import type { CheckResult, Context, Env, Module } from '../core/types.ts';
import { countLine, errorMessage, formatCheck, groupLabels, title } from '../core/ui.ts';

export interface DoctorFlags {
  all: boolean;
}

export interface ModuleReport {
  module: Module;
  results: CheckResult[];
}

/** A crashing check becomes a `fail` result instead of aborting the report. */
export async function runChecks(ctx: Context, list: Module[]): Promise<ModuleReport[]> {
  return Promise.all(
    list.map(async (module) => {
      try {
        const results = await module.check(ctx);
        return { module, results };
      } catch (err) {
        const results: CheckResult[] = [
          { status: 'fail', label: module.name, detail: `check crashed: ${errorMessage(err)}` },
        ];
        return { module, results };
      }
    }),
  );
}

export async function environmentChecks(env: Env): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push(
    env.os.debianFamily
      ? { status: 'ok', label: env.os.prettyName }
      : {
          status: 'warn',
          label: env.os.id ? env.os.prettyName : 'Unknown OS',
          hint: 'zaun needs an apt-based system (Ubuntu or Debian)',
        },
  );

  results.push(
    env.arch === 'arm64' || env.arch === 'amd64'
      ? { status: 'ok', label: `Architecture ${env.arch}` }
      : { status: 'warn', label: `Architecture ${env.arch}`, hint: 'only arm64 and amd64 are supported' },
  );

  results.push(
    env.isRoot
      ? { status: 'fail', label: 'Running as root', hint: 'use a normal user with sudo' }
      : { status: 'ok', label: `User ${env.user}`, detail: 'not root' },
  );

  if (env.isOrbStack) {
    const iso = await probeIsolation();
    const hint = 'create an isolated OrbStack machine (no Mac file sharing or `mac` command)';
    results.push(
      iso.macMount || iso.usersMount
        ? { status: 'fail', label: 'Mac files are visible', detail: iso.macMount ? '/mnt/mac' : '/Users', hint }
        : { status: 'ok', label: 'Mac files not mounted', detail: '/mnt/mac, /Users' },
      iso.macCommand
        ? { status: 'fail', label: '`mac` command reaches the host', hint }
        : { status: 'ok', label: '`mac` command cannot reach the host' },
    );
  }
  return results;
}

export function printReport(sections: [string, CheckResult[]][]): void {
  for (const [heading, results] of sections) {
    if (results.length === 0) continue;
    p.log.message([pc.bold(heading), ...results.map(formatCheck)].join('\n'));
  }
}

export function moduleSections(reports: ModuleReport[]): [string, CheckResult[]][] {
  return byGroup(reports.map((r) => ({ ...r, group: r.module.group }))).map(([group, items]) => [
    groupLabels[group],
    items.flatMap((r) => r.results),
  ]);
}

async function pickTargets(ctx: Context, flags: DoctorFlags): Promise<{ list: Module[]; note?: string }> {
  if (flags.all) return { list: modules };
  const state = readState();
  if (state && state.selected.length > 0) {
    const known = state.selected.filter((id) => modules.some((m) => m.id === id));
    return { list: resolvePlan(known, modules).ordered };
  }
  const installed = await Promise.all(modules.map((m) => m.isInstalled(ctx).catch(() => false)));
  return {
    list: modules.filter((_, i) => installed[i]),
    note: `No previous ${pc.cyan('zaun install')} found: checking modules that look installed. Use ${pc.cyan('--all')} to check everything.`,
  };
}

export async function doctor(flags: DoctorFlags): Promise<number> {
  p.intro(title('doctor'));

  const env = await detectEnv();
  const ctx = createContext({ env, options: { nonInteractive: true }, withLogFile: false });

  const s = p.spinner();
  s.start('Running checks');
  const { list, note } = await pickTargets(ctx, flags);
  const [envResults, reports] = await Promise.all([environmentChecks(env), runChecks(ctx, list)]);
  s.stop(list.length > 0 ? `Checked ${list.length} module${list.length === 1 ? '' : 's'}` : 'No modules to check');

  if (note) p.log.info(note);
  printReport([['Environment', envResults], ...moduleSections(reports)]);

  const all = [...envResults, ...reports.flatMap((r) => r.results)];
  const failed = all.some((r) => r.status === 'fail');
  p.outro(countLine(all));
  return failed ? 1 : 0;
}
