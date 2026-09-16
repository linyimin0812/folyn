#!/usr/bin/env node
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(here, '..', 'template');
const SHARED_DIR = TEMPLATE_DIR;
const TIERS = ['trusted', 'sandbox'] as const;
type Tier = (typeof TIERS)[number];

const DEFAULTS = {
  version: '0.1.0',
  folyn: '>=0.1.0',
};

const HELP = `Usage: create-folyn-extension [name] [options]

Scaffolds a Folyn extension in ./<name>/.

Options:
  --tier <trusted|sandbox>  Extension tier (REQUIRED — trusted: host-realm import(), inline React via window.React; sandbox: isolated iframe, postMessage RPC)
  --name <name>          Extension name (alternative to positional arg)
  --display-name <name>  Human-readable name (default: same as --name)
  --author <name>        Author (default: empty)
  --version <ver>        Extension version (default: ${DEFAULTS.version})
  --folyn <constraint>    Folyn engine compat (default: ${DEFAULTS.folyn})
  --yes, -y              Skip prompts; use defaults for missing fields (--tier still required)
  -h, --help             Show this help

Interactive (default TTY): prompts for any field not supplied via flags.
Non-interactive: pass --yes, supply all fields via flags/positional (--tier required).
Piped stdin (non-TTY) auto-enables --yes to avoid hanging on prompts.`;

function parseCliArgs(argv: string[]) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        tier: { type: 'string' },
        name: { type: 'string' },
        'display-name': { type: 'string' },
        author: { type: 'string' },
        version: { type: 'string' },
        folyn: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      args: argv,
    });
    return {
      tier: values.tier ?? null,
      name: values.name ?? positionals[0] ?? null,
      displayName: values['display-name'] ?? null,
      author: values.author ?? null,
      version: values.version ?? null,
      folyn: values.folyn ?? null,
      yes: Boolean(values.yes),
      help: Boolean(values.help),
    };
  } catch (e) {
    console.error((e as Error).message);
    console.error(HELP);
    process.exit(1);
  }
}

// ponytail: slug-style id from user-provided name. Lowercase, dashes only.
function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function prompt(rl: readline.Interface, q: string, defaultValue = ''): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}] ` : ': ';
  const a = (await rl.question(q.endsWith(':') ? q.slice(0, -1) + suffix : q + suffix)).trim();
  return a || defaultValue;
}

// Tier is a required choice — no default, re-prompt until a valid value is given.
async function promptTier(rl: readline.Interface): Promise<Tier> {
  for (;;) {
    const a = (await rl.question(`Extension tier (trusted|sandbox): `)).trim().toLowerCase();
    if (TIERS.includes(a as Tier)) return a as Tier;
    console.error(`✗ tier must be one of: ${TIERS.join(', ')}`);
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  let tier = args.tier;
  let name = args.name;
  let displayName = args.displayName;
  let author = args.author ?? '';
  let version = args.version ?? DEFAULTS.version;
  let folyn = args.folyn ?? DEFAULTS.folyn;
  const interactive = !args.yes && stdout.isTTY;

  // Validate --tier early when provided; prompt interactively otherwise.
  if (tier !== null && !TIERS.includes(tier as Tier)) {
    console.error(`✗ --tier must be one of: ${TIERS.join(', ')}, got: ${tier}`);
    console.error(HELP);
    process.exit(1);
  }

  if (interactive) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      if (tier === null) tier = await promptTier(rl);
      if (name === null) name = await prompt(rl, 'Extension name: ');
      if (displayName === null) displayName = await prompt(rl, 'Display name: ', name);
      if (author === '') author = await prompt(rl, 'Author (optional): ');
      version = await prompt(rl, 'Version: ', version);
      folyn = await prompt(rl, 'Folyn engine compat: ', folyn);
    } finally {
      rl.close();
    }
  }

  if (!tier) {
    console.error('Extension tier is required. Pass --tier <trusted|sandbox>, or run interactively (TTY).');
    console.error(HELP);
    process.exit(1);
  }
  if (!name) {
    console.error('Extension name is required. Pass it positionally or via --name, or run interactively (TTY).');
    console.error(HELP);
    process.exit(1);
  }

  const id = toId(name);
  if (!id) {
    console.error(`✗ invalid extension name: "${name}"`);
    process.exit(1);
  }
  const pkgName = id.startsWith('folyn-extension-') ? id : `folyn-extension-${id}`;
  const finalDisplayName = displayName || name;
  const target = resolve(process.cwd(), name);
  if (existsSync(target)) {
    console.error(`✗ ${target} already exists`);
    process.exit(1);
  }

  const placeholders: [string, string][] = [
    ['__id__', id],
    ['__pkgName__', pkgName],
    ['__Name__', finalDisplayName],
    ['__author__', author],
    ['__version__', version],
    ['__folyn__', folyn],
  ];
  // Files that may carry placeholders across either tier. Existence-checked —
  // a tier's dir won't have all of them (e.g. sandbox has src/index.html, trusted has shims).
  const filesToRewrite = [
    'package.json',
    'manifest.json',
    'tsconfig.json',
    'build.mjs',
    'README.md',
    'src/index.ts',
    'src/index.html',
    'src/react-shim.js',
    'src/react-jsx-runtime-shim.js',
  ];

  // Two-step copy: shared common files first, then the chosen tier's files
  // (overwriting/merging). The shared root also holds the trusted/ and
  // sandbox/ subtrees, so copy the common files individually rather than the
  // whole dir (which would drag the tier subtrees into the generated project).
  const sharedFiles = ['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'tsconfig.json'];
  await mkdir(target, { recursive: true });
  for (const f of sharedFiles) {
    await cp(join(SHARED_DIR, f), join(target, f));
  }
  await cp(join(TEMPLATE_DIR, tier), target, { recursive: true });
  for (const rel of filesToRewrite) {
    const p = join(target, rel);
    if (!existsSync(p)) continue;
    let s = await readFile(p, 'utf8');
    for (const [from, to] of placeholders) s = s.split(from).join(to);
    await writeFile(p, s);
  }

  console.log(`✓ created ${name}/ (${tier} tier)`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${name}`);
  console.log('  pnpm install   # or: npm install');
  console.log('  pnpm build');
  console.log('');
  console.log(tier === 'trusted'
    ? 'Then edit src/index.ts and manifest.json to add contributions (React via the shims in src/).'
    : 'Then edit src/index.ts (RPC bridge) and manifest.json to add contributions.');
  console.log('See folyn-extension-sdk/folyn-extension-plantuml (external repo) for a working example.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
