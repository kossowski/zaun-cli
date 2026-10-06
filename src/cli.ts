import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pc from 'picocolors';
import { doctor } from './commands/doctor.ts';
import { install } from './commands/install.ts';
import { ZAUN_DIR } from './core/paths.ts';
import { byGroup, modules } from './core/registry.ts';
import { groupLabels, isEmail } from './core/ui.ts';

const { version } = JSON.parse(readFileSync(join(ZAUN_DIR, 'package.json'), 'utf8')) as { version: string };

function help(): string {
  const moduleLines = byGroup(modules).map(
    ([group, mods]) => `  ${groupLabels[group].padEnd(20)} ${mods.map((m) => m.id).join(', ')}`,
  );
  return `${pc.bold('zaun')} ${version}: set up an isolated Ubuntu/Debian machine for AI-assisted development

${pc.bold('Usage')}
  zaun install [--only <ids> | --all] [--yes] [--git-name <name> --git-email <email>]
  zaun doctor [--all]

${pc.bold('Commands')}
  install              Choose modules and install them (interactive by default)
  doctor               Read-only health check of the machine and installed modules

${pc.bold('Options')}
  --only <ids>         Comma-separated module ids; dependencies are added automatically
  --all                Every module
  -y, --yes            No prompts: use --only/--all, else the last selection, else the defaults
  --git-name <name>    Git user.name for the git-config module (remembered for later runs)
  --git-email <email>  Git user.email for the git-config module (remembered for later runs)
  -h, --help           Show this help
  -v, --version        Show the version

${pc.bold('Modules')}
${moduleLines.join('\n')}

${pc.bold('Examples')}
  zaun install                          ${pc.dim('# interactive')}
  zaun install --only docker,gh --yes   ${pc.dim('# base is added automatically')}
  zaun install --all --yes --git-name "Ada Lovelace" --git-email ada@example.com
  zaun doctor
`;
}

function fail(message: string): never {
  console.error(`${pc.red('✗')} ${message}\n  Run ${pc.cyan('zaun --help')} for usage.`);
  process.exit(2);
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        only: { type: 'string' },
        all: { type: 'boolean', default: false },
        yes: { type: 'boolean', short: 'y', default: false },
        'git-name': { type: 'string' },
        'git-email': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (err) {
    fail((err as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    console.log(version);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(help());
    return 0;
  }
  if (rest.length > 0) fail(`Unexpected argument: ${rest[0]}`);

  if (process.getuid?.() === 0) {
    fail('Please run zaun as a normal user with sudo rights, not as root.');
  }

  const only = values.only
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (only && values.all) fail('Use either --only or --all, not both.');
  const unknown = only?.filter((id) => !modules.some((m) => m.id === id)) ?? [];
  if (unknown.length > 0) fail(`Unknown module: ${unknown.join(', ')}`);

  const gitName = values['git-name']?.trim();
  const gitEmail = values['git-email']?.trim();
  if (values['git-name'] !== undefined && !gitName) fail('--git-name must not be empty.');
  if (gitEmail !== undefined && !isEmail(gitEmail)) fail(`--git-email: not an email address: ${gitEmail}`);

  switch (command) {
    case 'install':
      // Without a TTY (CI, provisioning, `ssh host zaun install`) clack would hang or crash.
      if (!values.yes && !(process.stdin.isTTY && process.stdout.isTTY)) {
        fail('No terminal for the prompts: pass --yes (with --only <ids> or --all, and --git-name/--git-email).');
      }
      return install({ only, all: values.all, yes: values.yes, gitName, gitEmail });
    case 'doctor':
      if (only) fail('doctor does not take --only (use --all to check every module)');
      if (gitName !== undefined || gitEmail !== undefined) fail('--git-name/--git-email only work with install');
      return doctor({ all: values.all });
    default:
      fail(`Unknown command: ${command}`);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`${pc.red('✗')} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(1);
  },
);
