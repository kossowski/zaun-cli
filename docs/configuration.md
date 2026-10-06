# Configuration

## Your own settings (private overlay)

zaun ships a deliberately small config (`config/` in this repo). Your personal settings (model,
permissions, MCP servers, your skills) live in a **private overlay** in `~/.zaun-local/`, outside
the zaun repo, so updating zaun never conflicts with them and they never end up in a public repo.

```
~/.zaun-local/
├── claude/settings.json   optional: merged into ~/.claude/settings.json
├── codex/config.toml      optional: merged into ~/.codex/config.toml
├── skills.json            optional: appended to config/skills.json
├── state.json             zaun's own: your module selection, git identity, overlay choice
├── backups/<timestamp>/   zaun's own: every file zaun replaced
└── logs/                  zaun's own: install-<timestamp>.log
```

### How merging works

Claude Code and Codex write to their config files themselves, so zaun doesn't replace these
files. It merges three layers, later ones winning:

```
your existing file  <  zaun's base (config/…)  <  your overlay (~/.zaun-local/…)
```

- **objects / tables** merge key by key, recursively;
- **arrays** are concatenated without duplicates (you can add to a base list, not remove from it);
- **everything else**: the later layer wins.

Keys only Claude Code, Codex or you wrote (trusted projects, a `permissions` block, …) are kept.
The old file is backed up first. Codex's `config.toml` is rewritten without comments. Re-run
`zaun install` (or `zaun install --only claude-config,codex-config --yes`) after editing the
overlay; `zaun doctor` warns when a file differs from the merge result.

### Examples

`~/.zaun-local/claude/settings.json` ([settings reference](https://code.claude.com/docs/en/settings)):

```json
{
  "theme": "light",
  "permissions": {
    "allow": ["Bash(npm run test:*)", "Bash(gh pr view:*)"],
    "deny": ["Read(./.env)", "Read(./.env.*)"]
  },
  "env": {
    "DISABLE_TELEMETRY": "1"
  }
}
```

`~/.zaun-local/codex/config.toml` ([config reference](https://developers.openai.com/codex/config-reference)):

```toml
model_reasoning_effort = "high"
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

`~/.zaun-local/skills.json`: see [Agent skills](#agent-skills).

### Keep it in a private git repo

```sh
cd ~/.zaun-local
git init
printf 'state.json\nbackups/\nlogs/\n' > .gitignore
git add . && git commit -m "My zaun overlay"
gh repo create zaun-local --private --source . --push   # needs a token that can create repos, or create it in the web UI
```

On the next machine, choose _Clone a private git repo_ in the `zaun install` menu and enter its
URL (HTTPS works with the [GitHub token](github-token.md); an isolated OrbStack machine has no SSH agent).
zaun clones it only into an empty `~/.zaun-local` and runs `git pull --ff-only` on later
installs. Cloning before your first `gh` login? Run the first install with no overlay, log in with the [GitHub token](github-token.md),
then run `zaun install` again.

## Agent skills

[Skills](https://skills.sh) are folders with a `SKILL.md` that teach an agent a task. The
`skills` module installs them for your user with the `skills` CLI. The list lives in
`config/skills.json` (empty on purpose) and in your overlay `~/.zaun-local/skills.json`; both
have the same format and are concatenated:

```json
{
  "skills": [
    {
      "source": "vercel-labs/agent-skills",
      "skills": ["web-design-guidelines"]
    },
    {
      "source": "anthropics/skills",
      "skills": ["skill-creator"],
      "agents": ["claude-code"]
    }
  ]
}
```

| Field    | Meaning                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `source` | required: a GitHub `owner/repo`, or anything `npx skills add` accepts                                                        |
| `skills` | optional: which skills from the source; omit to install all of them                                                          |
| `agents` | optional: [skills CLI agent ids](https://github.com/vercel-labs/skills#supported-agents); default `["claude-code", "codex"]` |

For each entry zaun runs `npx -y skills add <source> -g -y -a <agent>… [-s <skill>…]`. Skills
land in `~/.agents/skills/` (Codex reads them there) with links in `~/.claude/skills/`. The
`skills` module is not preselected; pick it in the menu or run:

```sh
zaun install --only skills --yes
```

Only install skills from sources you trust: a skill is instructions your agent will follow.
