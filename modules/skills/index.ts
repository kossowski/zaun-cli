// skills: agent skills (SKILL.md folders) installed globally with the skills
// CLI from https://skills.sh (github.com/vercel-labs/skills).
//
// The list comes from config/skills.json (empty by default) plus your private
// overlay ~/.zaun-local/skills.json; both look like
//
//   { "skills": [ { "source": "owner/repo", "skills": ["name"], "agents": ["claude-code", "codex"] } ] }
//
// For each entry zaun runs
//
//   npx -y skills add <source> -g -y -a <agent> ... [-s <skill> ...]
//
// -g installs for your user (not the current project), -y skips the prompts.
// The CLI keeps one copy per skill in ~/.agents/skills/<name> (which Codex and
// other "universal" agents read directly) and symlinks it into agent-specific
// folders such as ~/.claude/skills. It records what it installed, and from
// where, in ~/.agents/.skill-lock.json.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineModule, shellQuote, tildify, type Context } from '../../src/core/kit.ts';

interface SkillEntry {
  /** Anything `skills add` accepts, usually a GitHub owner/repo. */
  source: string;
  /** Skill names to install from the source; omitted = all of them. */
  skills?: string[];
  /** skills CLI agent ids; default DEFAULT_AGENTS. */
  agents?: string[];
}

const DEFAULT_AGENTS = ['claude-code', 'codex'];

function listFiles(ctx: Context): string[] {
  return [join(ctx.paths.configDir, 'skills.json'), join(ctx.paths.localDir, 'skills.json')];
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== '');

/** Read and validate one skills.json. Throws with the file name on any problem. */
function readList(path: string): SkillEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${tildify(path)}: ${(err as Error).message}`);
  }
  const list = (data as { skills?: unknown })?.skills ?? [];
  if (!Array.isArray(list)) throw new Error(`${tildify(path)}: "skills" must be a list`);
  return list.map((entry, i) => {
    const e = entry as Partial<SkillEntry>;
    const where = `${tildify(path)}: skills[${i}]`;
    if (typeof e?.source !== 'string' || e.source.trim() === '') throw new Error(`${where} needs a "source"`);
    if (e.skills !== undefined && !isStringArray(e.skills)) throw new Error(`${where}.skills must be a list of names`);
    if (e.agents !== undefined && !isStringArray(e.agents)) throw new Error(`${where}.agents must be a list of agent ids`);
    return { source: e.source.trim(), skills: e.skills, agents: e.agents };
  });
}

function entries(ctx: Context): SkillEntry[] {
  return listFiles(ctx)
    .filter((p) => existsSync(p))
    .flatMap(readList);
}

/** The exact command for one entry (also what we log). */
function addCommand(entry: SkillEntry): string {
  const agents = entry.agents?.length ? entry.agents : DEFAULT_AGENTS;
  const parts = ['npx', '-y', 'skills', 'add', shellQuote(entry.source), '-g', '-y'];
  for (const agent of agents) parts.push('-a', shellQuote(agent));
  for (const skill of entry.skills ?? []) parts.push('-s', shellQuote(skill));
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Where the skills CLI puts global skills (mirrors its source, skills v1.x).
// ---------------------------------------------------------------------------

/** Folder name the CLI uses for a skill (its `sanitizeName`). */
function folderName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 255) || 'unnamed-skill'
  );
}

/**
 * The global skills folder of an agent, for the agents zaun knows. Codex is a
 * "universal" agent in the skills CLI: it reads the shared ~/.agents/skills,
 * so global installs for it land there and nowhere else. Claude Code gets a
 * symlink (or copy) in ~/.claude/skills. For other agents we only consult the
 * lock file.
 */
function agentSkillsDir(ctx: Context, agent: string): string | undefined {
  const home = ctx.paths.home;
  switch (agent) {
    case 'claude-code':
      return join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'skills');
    case 'codex':
      return join(home, '.agents', 'skills');
    default:
      return undefined;
  }
}

function lockFile(ctx: Context): string {
  const state = process.env.XDG_STATE_HOME;
  return state ? join(state, 'skills', '.skill-lock.json') : join(ctx.paths.home, '.agents', '.skill-lock.json');
}

/** Skill name → source, as recorded in the lock file ({} if there is none). */
function lockedSkills(ctx: Context): Record<string, string> {
  try {
    const lock = JSON.parse(readFileSync(lockFile(ctx), 'utf8')) as { skills?: Record<string, { source?: string }> };
    return Object.fromEntries(Object.entries(lock.skills ?? {}).map(([name, info]) => [name, info.source ?? '']));
  } catch {
    return {};
  }
}

/** What's missing for one entry, as readable strings; [] = all there. Read-only. */
function missingFor(ctx: Context, entry: SkillEntry): string[] {
  const agents = entry.agents?.length ? entry.agents : DEFAULT_AGENTS;
  const locked = lockedSkills(ctx);
  // "All skills from a source": the lock file knows which ones that were.
  const names = entry.skills?.length
    ? entry.skills
    : Object.keys(locked).filter((name) => locked[name]?.toLowerCase() === entry.source.toLowerCase());
  if (names.length === 0) return [`${entry.source} (nothing installed from it)`];
  const missing: string[] = [];
  for (const name of names) {
    const lacking = agents.filter((agent) => {
      const dir = agentSkillsDir(ctx, agent);
      return dir ? !existsSync(join(dir, folderName(name), 'SKILL.md')) : !(name in locked);
    });
    if (lacking.length > 0) missing.push(`${name} (${lacking.join(', ')})`);
  }
  return missing;
}

export default defineModule({
  id: 'skills',
  name: 'Agent skills',
  group: 'config',
  description: 'Skills from config/skills.json and your overlay',
  deps: ['node', 'claude-code'],
  sudo: false,
  defaultSelected: false,

  async isInstalled(ctx) {
    try {
      return entries(ctx).every((entry) => missingFor(ctx, entry).length === 0);
    } catch {
      return false; // invalid list: let install report it
    }
  },

  async install(ctx) {
    const list = entries(ctx);
    if (list.length === 0) {
      ctx.log.info('no skills configured: add entries to ~/.zaun-local/skills.json (see config/skills.json)');
      return;
    }
    if (!(await ctx.exists('npx'))) {
      throw new Error('npx not found: install Node first (`zaun install --only node`)');
    }
    for (const entry of list) {
      if (missingFor(ctx, entry).length === 0) {
        ctx.log.info(`skills from ${entry.source}: already installed`);
        continue;
      }
      ctx.progress(`installing skills from ${entry.source}`);
      const cmd = addCommand(entry);
      ctx.log.info(`$ ${cmd}`);
      // npx may download the CLI and the CLI clones the source repo: allow some time.
      await ctx.run(cmd, { timeoutMs: 5 * 60_000 });
    }
  },

  async check(ctx) {
    let list: SkillEntry[];
    try {
      list = entries(ctx);
    } catch (err) {
      return [{ status: 'fail', label: 'Agent skills', detail: (err as Error).message }];
    }
    if (list.length === 0) {
      return [
        {
          status: 'ok',
          label: 'Agent skills',
          detail: 'none configured (add some in ~/.zaun-local/skills.json)',
        },
      ];
    }
    const missing = list.flatMap((entry) => missingFor(ctx, entry));
    if (missing.length > 0) {
      return [
        {
          status: 'fail',
          label: 'Agent skills',
          detail: `missing: ${missing.join(', ')}`,
          hint: 'run `zaun install --only skills`',
        },
      ];
    }
    return [{ status: 'ok', label: 'Agent skills', detail: list.map((e) => e.source).join(', ') }];
  },
});
