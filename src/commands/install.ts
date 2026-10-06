import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { createContext, primeSudo, stopSudoKeepAlive, type RunnerContext } from '../core/context.ts';
import { detectEnv } from '../core/env.ts';
import { DependencyError, resolvePlan } from '../core/order.ts';
import { cloneOverlay, overlayIsGitRepo, pullOverlay } from '../core/overlay.ts';
import { localDir, tildify } from '../core/paths.ts';
import { byGroup, modules } from '../core/registry.ts';
import { emptyState, readState, writeState, type OverlayChoice, type State } from '../core/state.ts';
import type { Env, Module } from '../core/types.ts';
import {
  envLine,
  errorMessage,
  groupLabels,
  inlineCode,
  isEmail,
  orExit,
  symbols,
  title,
} from '../core/ui.ts';
import { moduleSections, printReport, runChecks } from './doctor.ts';

export interface InstallFlags {
  only?: string[];
  all: boolean;
  yes: boolean;
  gitName?: string;
  gitEmail?: string;
}

/** Modules whose config can be extended by the private overlay. */
const OVERLAY_USERS = new Set(['claude-config', 'codex-config', 'skills']);

export async function install(flags: InstallFlags): Promise<number> {
  // Checked before createContext adds it: ~/.profile only adds ~/.local/bin if it
  // existed at login, so on a fresh machine new tools need a new terminal.
  const pathLacksLocalBin = !(process.env.PATH ?? '').split(delimiter).includes(join(homedir(), '.local', 'bin'));

  p.intro(title('install'));

  const env = await detectEnv();
  p.log.info(envLine(env));
  warnAboutEnvironment(env);

  const state: State = readState() ?? emptyState();
  const interactive = !flags.yes;

  const s = p.spinner();
  s.start('Looking at what is already installed');
  const probe = createContext({ env, options: { nonInteractive: true }, withLogFile: false });
  const installed = new Set<string>();
  await refreshInstalled(probe, modules, installed);
  s.stop(`${installed.size} of ${modules.length} modules already installed`);

  const selected = await chooseModules(flags, state, installed);

  let plan;
  try {
    plan = resolvePlan(selected, modules);
  } catch (err) {
    if (!(err instanceof DependencyError)) throw err;
    p.cancel(err.message);
    return 1;
  }
  const planIds = new Set(plan.ordered.map((m) => m.id));

  let overlay: OverlayChoice = state.overlay ?? { kind: 'none' };
  if (interactive && [...planIds].some((id) => OVERLAY_USERS.has(id))) {
    overlay = await chooseOverlay(overlay);
  }

  const gitFlags = flags.gitName !== undefined || flags.gitEmail !== undefined;
  const git =
    planIds.has('git-config') || gitFlags ? await gitIdentity(state, flags, interactive && planIds.has('git-config')) : state.git;
  if (planIds.has('git-config') && !git) {
    p.log.warn(
      inlineCode('No git name/email known yet: pass `--git-name` and `--git-email`, or run `zaun install` interactively.'),
    );
  }

  probe.options.gitName = git?.name;
  probe.options.gitEmail = git?.email;
  await refreshInstalled(probe, plan.ordered.filter((m) => m.id === 'git-config'), installed);

  // A clone or pull may change these modules. Installed ones are checked again
  // after the overlay update, but don't count as pending in the confirmation.
  const recheck = plan.ordered.filter((m) => overlay.kind === 'git' && OVERLAY_USERS.has(m.id) && installed.has(m.id));

  let toRun = plan.ordered.filter((m) => !installed.has(m.id));
  p.note(planText(plan.ordered, plan.added, installed, new Set(recheck.map((m) => m.id))), 'Plan');

  if (toRun.length === 0) {
    p.log.success('Everything selected is already installed.');
  } else if (interactive) {
    const count = `${toRun.length} module${toRun.length === 1 ? '' : 's'}`;
    const ok = orExit(await p.confirm({ message: `Install ${count}?` }));
    if (!ok) {
      p.cancel('Cancelled. Nothing was changed.');
      return 130;
    }
  }

  // Remember the choices right away, so a failed run still preselects them next time.
  Object.assign(state, { selected, overlay, git, lastRun: new Date().toISOString() });
  writeState(state);

  prepareOverlay(overlay);
  if (recheck.length > 0) {
    // refreshInstalled only touches `recheck`, which was never in toRun: the
    // update can add modules to the plan the user approved, never remove any.
    await refreshInstalled(probe, recheck, installed);
    const changed = recheck.filter((m) => !installed.has(m.id));
    const names = changed.map((m) => m.name).join(', ');
    let declined = new Set<string>();
    if (changed.length > 0 && interactive) {
      const ok = orExit(
        await p.confirm({ message: `The overlay update changed ${names}. Apply it too?` }),
        'Cancelled. The overlay was updated and your choices were saved, but nothing was installed.',
      );
      if (!ok) {
        p.log.info(`Skipping ${names}.`);
        declined = new Set(changed.map((m) => m.id));
      }
    } else if (changed.length > 0) {
      p.log.step(`The overlay update changed ${names}; applying it.`);
    }
    toRun = plan.ordered.filter((m) => !installed.has(m.id) && !declined.has(m.id));
  }

  const sudoFor = toRun.filter((m) => m.sudo);
  if (sudoFor.length > 0 && !hasPasswordlessSudo()) {
    p.log.step(`sudo is needed for ${sudoFor.map((m) => m.name).join(', ')}`);
  }
  if (sudoFor.length > 0 && !primeSudo()) {
    p.cancel('Could not get sudo. Nothing was installed.');
    return 1;
  }

  const ctx = createContext({
    env,
    options: { gitName: git?.name, gitEmail: git?.email, nonInteractive: !interactive },
    withLogFile: toRun.length > 0,
  });
  const logPath = ctx.paths.logFile ? tildify(ctx.paths.logFile) : '';
  const outcome = await runModules(ctx, toRun, logPath);
  stopSudoKeepAlive();

  for (const id of outcome.succeeded) state.installed[id] = new Date().toISOString();
  writeState(state);

  if (plan.ordered.length > 0) {
    const s2 = p.spinner();
    s2.start('Running health checks');
    const reports = await runChecks(ctx, plan.ordered);
    s2.stop('Health check');
    printReport(moduleSections(reports));
  }

  const ready = plan.ordered.filter((m) => !outcome.failed.has(m.id) && !outcome.skipped.has(m.id));
  const steps = await nextSteps(ctx, ready);
  // One shell-reload step for everything (PATH, zsh, starship, fnm), last in the list.
  if (outcome.succeeded.length > 0 || pathLacksLocalBin) {
    steps.push(
      ready.some((m) => m.id === 'shell')
        ? 'Open a new terminal (or run `exec zsh`) to start zsh with starship and the new PATH'
        : 'Open a new terminal (or run `exec $SHELL -l`) so the new PATH (`zaun`, tools in ~/.local/bin) is picked up',
    );
  }
  if (steps.length > 0) {
    p.note(steps.map((step) => `${pc.dim('•')} ${inlineCode(step)}`).join('\n'), 'Next steps');
  }

  if (outcome.failed.size > 0 || outcome.skipped.size > 0) {
    const failed = [...outcome.failed].join(', ');
    const skipped = outcome.skipped.size > 0 ? `, skipped ${[...outcome.skipped].join(', ')}` : '';
    p.outro(`${symbols.fail} ${pc.red(`Failed: ${failed}`)}${skipped}. Full log: ${logPath}`);
    return 1;
  }
  const logNote = logPath ? ` Log: ${pc.dim(logPath)}` : '';
  p.outro(`${symbols.ok} Done. Check again any time with ${pc.cyan('zaun doctor')}.${logNote}`);
  return 0;
}

function warnAboutEnvironment(env: Env): void {
  if (!env.os.debianFamily) {
    p.log.warn('zaun needs an apt-based system (Ubuntu or Debian). Continuing anyway.');
  }
  if (env.isOrbStack && !env.isIsolated) {
    p.log.warn(
      `This OrbStack machine can reach your Mac. AI agents running here could too.\n` +
        `Consider an isolated machine (no Mac file sharing). ${pc.cyan('zaun doctor')} shows details.`,
    );
  }
}

async function chooseModules(flags: InstallFlags, state: State, installed: Set<string>): Promise<string[]> {
  if (flags.all) return modules.map((m) => m.id);
  if (flags.only) return flags.only;

  const known = state.selected.filter((id) => modules.some((m) => m.id === id));
  const initial = known.length > 0 ? known : modules.filter((m) => m.defaultSelected).map((m) => m.id);
  if (flags.yes) return initial;

  const options = Object.fromEntries(
    byGroup(modules).map(([group, mods]) => [
      groupLabels[group],
      mods.map((m) => ({
        value: m.id,
        label: installed.has(m.id) ? `${m.name} ${pc.green('✓ installed')}` : m.name,
        hint: m.description,
      })),
    ]),
  );
  return orExit(
    await p.groupMultiselect({
      message: 'What should zaun set up?',
      options,
      initialValues: initial,
      required: true,
    }),
  );
}

async function chooseOverlay(current: OverlayChoice): Promise<OverlayChoice> {
  const dir = tildify(localDir());
  if (current.kind === 'git' && overlayIsGitRepo()) {
    p.log.info(`Private overlay: ${dir} (git, from ${current.url})`);
    return current;
  }
  const kind = orExit(
    await p.select({
      message: 'Private overlay (your own additions on top of the shipped config)',
      initialValue: current.kind,
      options: [
        { value: 'none', label: 'None', hint: 'use the shipped config only' },
        { value: 'local', label: `Local folder ${dir}`, hint: 'files you create there by hand' },
        { value: 'git', label: 'Clone a private git repo', hint: `into ${dir}` },
      ],
    }),
  );
  if (kind !== 'git') return { kind };
  const url = orExit(
    await p.text({
      message: 'Git URL of your overlay repo',
      placeholder: 'git@github.com:you/zaun-local.git',
      validate: (v) => (v && v.trim() ? undefined : 'Please enter a URL'),
    }),
  );
  return { kind: 'git', url: url.trim() };
}

/**
 * Precedence: flags, then the live git config (so manual changes are kept), then
 * state.json. Prompts (prefilled) only when interactive and a flag is missing.
 */
async function gitIdentity(state: State, flags: InstallFlags, interactive: boolean): Promise<State['git']> {
  const fromGit = (key: string) =>
    spawnSync('git', ['config', '--global', key], { encoding: 'utf8' }).stdout?.trim() || '';
  const name = flags.gitName || fromGit('user.name') || state.git?.name || '';
  const email = flags.gitEmail || fromGit('user.email') || state.git?.email || '';
  const bothFlags = Boolean(flags.gitName && flags.gitEmail);
  if (!interactive || bothFlags) return name && email ? { name, email } : state.git;

  p.note('This is not a login: GitHub access is set up after the install (`gh auth login`).', 'Git commit author');
  const required = (v: string | undefined) => (v && v.trim() ? undefined : 'Required');
  const newName = orExit(
    await p.text({ message: 'Your name (shown as commit author)', initialValue: name, validate: required }),
  );
  const newEmail = orExit(
    await p.text({
      message: 'Your email (shown on commits; GitHub matches it to your account)',
      initialValue: email,
      validate: (v) => (v && isEmail(v.trim()) ? undefined : 'Please enter an email address'),
    }),
  );
  return { name: newName.trim(), email: newEmail.trim() };
}

async function refreshInstalled(ctx: RunnerContext, list: Module[], installed: Set<string>): Promise<void> {
  const results = await Promise.all(list.map((m) => m.isInstalled(ctx).catch(() => false)));
  for (const [i, mod] of list.entries()) {
    if (results[i]) installed.add(mod.id);
    else installed.delete(mod.id);
  }
}

function planText(ordered: Module[], added: string[], installed: Set<string>, recheck: Set<string>): string {
  return byGroup(ordered)
    .map(([group, mods]) => {
      const lines = mods.map((m) => {
        const tags = [
          added.includes(m.id) ? 'needed by another module' : null,
          installed.has(m.id) && !recheck.has(m.id) ? 'already installed, skipped' : null,
          recheck.has(m.id) ? 'check after overlay update' : null,
          m.sudo && !installed.has(m.id) ? 'sudo' : null,
        ].filter(Boolean);
        const mark = installed.has(m.id) ? symbols.ok : pc.cyan('+');
        return `${mark} ${m.name}${tags.length ? pc.dim(`  ${tags.join(' · ')}`) : ''}`;
      });
      return [pc.bold(groupLabels[group]), ...lines].join('\n');
    })
    .join('\n');
}

function prepareOverlay(overlay: OverlayChoice): void {
  if (overlay.kind !== 'git') return;
  try {
    if (overlayIsGitRepo()) {
      const err = pullOverlay();
      if (err) p.log.warn(`Could not update the overlay (${err}). Using it as is.`);
    } else {
      p.log.step(`Cloning ${overlay.url}`);
      cloneOverlay(overlay.url);
      p.log.success(`Overlay cloned into ${tildify(localDir())}`);
    }
  } catch (err) {
    p.log.warn(`${errorMessage(err)}. Continuing without changing the overlay.`);
  }
}

function hasPasswordlessSudo(): boolean {
  return spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status === 0;
}

interface Outcome {
  succeeded: string[];
  failed: Set<string>;
  skipped: Set<string>;
}

/** A failure doesn't stop the run: only modules depending on the failed one are skipped. */
async function runModules(ctx: RunnerContext, toRun: Module[], logPath: string): Promise<Outcome> {
  const outcome: Outcome = { succeeded: [], failed: new Set(), skipped: new Set() };
  let current: ReturnType<typeof p.spinner> | null = null;

  // Ctrl+C while installing: children get the signal too (same process group).
  // Say where we stopped and where the log is, instead of dying silently.
  const onInterrupt = () => {
    current?.cancel('Interrupted');
    stopSudoKeepAlive();
    p.cancel(`Stopped. Modules already done stay installed; run ${pc.cyan('zaun install')} again to continue.\n${pc.dim(`Log: ${logPath}`)}`);
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  for (const mod of toRun) {
    // Modules run in dependency order, so checking direct deps also covers deeper
    // chains: anything depending on a skipped module is itself skipped.
    const blockedBy = mod.deps?.find((d) => outcome.failed.has(d) || outcome.skipped.has(d));
    if (blockedBy) {
      outcome.skipped.add(mod.id);
      p.log.warn(`${mod.name} ${pc.dim(`skipped: needs ${blockedBy}`)}`);
      continue;
    }

    const started = Date.now();
    const s = p.spinner();
    current = s;
    s.start(mod.name);
    ctx.onProgress = (msg) => s.message(`${mod.name} ${pc.dim(msg)}`);
    ctx.warnings = [];
    ctx.log.info(`===== ${mod.id} =====`);

    try {
      await mod.install(ctx);
      s.stop(`${mod.name} ${pc.dim(seconds(started))}`);
      outcome.succeeded.push(mod.id);
    } catch (err) {
      s.error(`${mod.name} ${pc.red('failed')}`);
      ctx.log.info(`[error] ${errorMessage(err)}`);
      p.log.error(`${errorMessage(err)}\n${pc.dim(`Log: ${logPath}`)}`);
      outcome.failed.add(mod.id);
    }
    for (const w of ctx.warnings) p.log.warn(`${mod.name}: ${w}`);
    ctx.onProgress = null;
    current = null;
  }

  process.off('SIGINT', onInterrupt);
  return outcome;
}

function seconds(since: number): string {
  const s = Math.round((Date.now() - since) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function nextSteps(ctx: RunnerContext, mods: Module[]): Promise<string[]> {
  const lists = await Promise.all(
    mods.map(async (m) => {
      try {
        return (await m.nextSteps?.(ctx)) ?? [];
      } catch {
        return []; // a broken hint must never fail the install
      }
    }),
  );
  return lists.flat();
}
