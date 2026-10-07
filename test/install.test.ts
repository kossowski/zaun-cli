// Exercise install planning without system installers or the user's config.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as p from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { install } from '../src/commands/install.ts';
import * as context from '../src/core/context.ts';
import * as overlay from '../src/core/overlay.ts';
import { modules } from '../src/core/registry.ts';
import { emptyState, writeState } from '../src/core/state.ts';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(), outro: vi.fn(), note: vi.fn(), cancel: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), success: vi.fn(), step: vi.fn(), error: vi.fn() },
  spinner: () => ({ start() {}, stop() {}, message() {}, cancel() {}, error() {} }),
  confirm: vi.fn(), select: vi.fn(), text: vi.fn(), isCancel: (value: unknown) => typeof value === 'symbol',
}));

const createContext = context.createContext;
const original = new Map(modules.map((m) => [m.id, { isInstalled: m.isInstalled, install: m.install }]));
const mod = (id: string) => modules.find((m) => m.id === id)!;
let home: string;
let local: string;

function useRealModule(id: string) {
  vi.mocked(mod(id).isInstalled).mockImplementation(original.get(id)!.isInstalled);
  vi.mocked(mod(id).install).mockImplementation(original.get(id)!.install);
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'zaun-install-test-'));
  local = join(home, '.zaun-local');
  vi.stubEnv('ZAUN_LOCAL_DIR', local);
  vi.stubEnv('GIT_CONFIG_GLOBAL', join(home, '.gitconfig'));
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('PATH', process.env.PATH ?? '');
  vi.spyOn(context, 'createContext').mockImplementation((options) => {
    const ctx = createContext(options);
    ctx.paths.home = home;
    return ctx;
  });
  for (const m of modules) {
    vi.spyOn(m, 'isInstalled').mockResolvedValue(true);
    vi.spyOn(m, 'install').mockResolvedValue(undefined);
    vi.spyOn(m, 'check').mockResolvedValue([]);
    if (m.nextSteps) vi.spyOn(m, 'nextSteps').mockReturnValue([]);
  }
  vi.spyOn(overlay, 'overlayIsGitRepo').mockReturnValue(true);
  vi.spyOn(overlay, 'pullOverlay').mockReturnValue(null);
  vi.spyOn(overlay, 'cloneOverlay').mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(home, { recursive: true, force: true });
});

/** Run the real git-config module against `values` instead of git and install.sh. */
function fakeGitConfig(values: Record<string, string>) {
  useRealModule('git-config');
  const makeContext = vi.mocked(context.createContext).getMockImplementation()!;
  vi.mocked(context.createContext).mockImplementation((options) => {
    const ctx = makeContext(options);
    ctx.tryRun = async (cmd) => {
      const key = cmd.match(/'([^']+)'$/)?.[1] ?? '';
      return { ok: key in values, code: key in values ? 0 : 1, stdout: values[key] ?? '', stderr: '' };
    };
    ctx.runScript = async (_id, args = []) => {
      if (args[0] === '--list') {
        return Object.entries(values).filter(([key]) => !key.startsWith('user.')).map(([key, value]) => `${key}=${value}`).join('\n');
      }
      values['user.name'] = args[args.indexOf('--name') + 1]!;
      values['user.email'] = args[args.indexOf('--email') + 1]!;
      return '';
    };
    return ctx;
  });
}

const gitDefaults = {
  'init.defaultBranch': 'main', 'pull.rebase': 'false',
  'push.autoSetupRemote': 'true', 'fetch.prune': 'true',
};

describe('install planning', () => {
  it('applies a changed Git identity even when the existing setup is complete', async () => {
    const values: Record<string, string> = { 'user.name': 'Old Name', 'user.email': 'old@example.com', ...gitDefaults };
    fakeGitConfig(values);
    expect(await install({ only: ['git-config'], all: false, yes: true, gitName: 'New Name', gitEmail: 'new@example.com' })).toBe(0);
    expect(values['user.name']).toBe('New Name');
    expect(values['user.email']).toBe('new@example.com');
    expect(mod('git-config').install).toHaveBeenCalledOnce();
  });

  it('keeps a Git identity changed by hand instead of the one remembered in state', async () => {
    const values: Record<string, string> = { 'user.name': 'New Name', 'user.email': 'new@example.com', ...gitDefaults };
    fakeGitConfig(values);
    write(join(home, '.gitconfig'), '[user]\n\tname = New Name\n\temail = new@example.com\n');
    writeState({ ...emptyState(), git: { name: 'Old Name', email: 'old@example.com' } });
    expect(await install({ only: ['git-config'], all: false, yes: true })).toBe(0);
    expect(mod('git-config').install).not.toHaveBeenCalled();
    expect(values['user.name']).toBe('New Name');
    expect(values['user.email']).toBe('new@example.com');
  });

  it.each(['clone', 'pull'] as const)('applies config from an overlay %s during the same run', async (operation) => {
    useRealModule('codex-config');
    const target = join(home, '.codex', 'config.toml');
    write(target, 'file_opener = "none"\n');
    writeState({ ...emptyState(), overlay: { kind: 'git', url: 'fixture' } });
    vi.mocked(overlay.overlayIsGitRepo).mockReturnValue(operation === 'pull');
    const update = () => write(join(local, 'codex', 'config.toml'), 'model = "overlay-model"\n');
    vi.mocked(overlay.cloneOverlay).mockImplementation(update);
    vi.mocked(overlay.pullOverlay).mockImplementation(() => { update(); return null; });

    expect(await install({ only: ['codex-config'], all: false, yes: true })).toBe(0);
    expect(readFileSync(target, 'utf8')).toContain('model = "overlay-model"');
    expect(mod('codex-config').install).toHaveBeenCalledOnce();
  });

  it('skips overlay modules when an update changes nothing', async () => {
    writeState({ ...emptyState(), overlay: { kind: 'git', url: 'fixture' } });
    expect(await install({ only: ['claude-config', 'codex-config'], all: false, yes: true })).toBe(0);
    for (const id of ['claude-config', 'codex-config']) expect(mod(id).install).not.toHaveBeenCalled();
  });

  it('does not ask when only an overlay check is pending', async () => {
    writeState({ ...emptyState(), overlay: { kind: 'git', url: 'fixture' } });
    vi.mocked(p.confirm).mockResolvedValue(false);
    expect(await install({ only: ['claude-config', 'codex-config'], all: false, yes: false })).toBe(0);
    expect(p.confirm).not.toHaveBeenCalled();
    expect(p.cancel).not.toHaveBeenCalled();
    expect(p.log.success).toHaveBeenCalledWith('Everything selected is already installed.');
    expect(overlay.pullOverlay).toHaveBeenCalledOnce();
    for (const id of ['claude-config', 'codex-config']) expect(mod(id).install).not.toHaveBeenCalled();
  });

  it.each([false, true])('asks again before applying an overlay change (accepted: %s)', async (accept) => {
    writeState({ ...emptyState(), overlay: { kind: 'git', url: 'fixture' } });
    vi.mocked(mod('codex').isInstalled).mockResolvedValue(false);
    let pulled = false;
    vi.mocked(overlay.pullOverlay).mockImplementation(() => { pulled = true; return null; });
    vi.mocked(mod('codex-config').isInstalled).mockImplementation(async () => !pulled);
    vi.mocked(p.confirm).mockImplementation(async ({ message }) => message.startsWith('Install') || accept);

    expect(await install({ only: ['codex', 'codex-config'], all: false, yes: false })).toBe(0);
    expect(p.confirm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(p.confirm).mock.calls[1]![0].message).toContain(mod('codex-config').name);
    expect(mod('codex').install).toHaveBeenCalledOnce();
    expect(mod('codex-config').install).toHaveBeenCalledTimes(accept ? 1 : 0);
  });

  it('says the overlay was updated when the second confirmation is cancelled', async () => {
    writeState({ ...emptyState(), overlay: { kind: 'git', url: 'fixture' } });
    vi.mocked(mod('codex').isInstalled).mockResolvedValue(false);
    let pulled = false;
    vi.mocked(overlay.pullOverlay).mockImplementation(() => { pulled = true; return null; });
    vi.mocked(mod('codex-config').isInstalled).mockImplementation(async () => !pulled);
    const cancel = Symbol('clack:cancel') as Awaited<ReturnType<typeof p.confirm>>;
    vi.mocked(p.confirm).mockImplementation(async ({ message }) => (message.startsWith('Install') ? true : cancel));
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit ${code}`); });

    await expect(install({ only: ['codex', 'codex-config'], all: false, yes: false })).rejects.toThrow('exit 130');
    expect(p.confirm).toHaveBeenCalledTimes(2);
    expect(p.cancel).toHaveBeenCalledWith(
      'Cancelled. The overlay was updated and your choices were saved, but nothing was installed.',
    );
    expect(overlay.pullOverlay).toHaveBeenCalledOnce();
    expect(mod('codex').install).not.toHaveBeenCalled();
    expect(mod('codex-config').install).not.toHaveBeenCalled();
  });

  it('does not update the overlay when confirmation is declined', async () => {
    writeState({ ...emptyState(), overlay: { kind: 'git', url: 'fixture' } });
    vi.mocked(mod('codex-config').isInstalled).mockResolvedValue(false);
    vi.mocked(p.confirm).mockResolvedValue(false);
    expect(await install({ only: ['codex-config'], all: false, yes: false })).toBe(130);
    expect(overlay.pullOverlay).not.toHaveBeenCalled();
    expect(overlay.cloneOverlay).not.toHaveBeenCalled();
    expect(mod('codex-config').install).not.toHaveBeenCalled();
  });
});
