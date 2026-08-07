#!/usr/bin/env node
import { cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(here, '..', 'template');

const DEFAULTS = {
  version: '0.1.0',
  quill: '>=0.1.0',
};

const HELP = `Usage: create-quill-plugin [name] [options]

Scaffolds a Quill plugin in ./<name>/.

Options:
  --name <name>          Plugin name (alternative to positional arg)
  --display-name <name>  Human-readable name (default: same as --name)
  --author <name>        Author (default: empty)
  --version <ver>        Plugin version (default: ${DEFAULTS.version})
  --quill <constraint>    Quill engine compat (default: ${DEFAULTS.quill})
  --yes, -y              Skip prompts; use defaults for missing fields
  -h, --help             Show this help

Interactive (default TTY): prompts for any field not supplied via flags.
Non-interactive: pass --yes, supply all fields via flags/positional.
Piped stdin (non-TTY) auto-enables --yes to avoid hanging on prompts.`;

function parseCliArgs(argv: string[]) {
  try {
    const { values, positionals } = parseArgs({
      options: {
        name: { type: 'string' },
        'display-name': { type: 'string' },
        author: { type: 'string' },
        version: { type: 'string' },
        quill: { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      args: argv,
    });
    return {
      name: values.name ?? positionals[0] ?? null,
      displayName: values['display-name'] ?? null,
      author: values.author ?? null,
      version: values.version ?? null,
      quill: values.quill ?? null,
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

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  let name = args.name;
  let displayName = args.displayName;
  let author = args.author ?? '';
  let version = args.version ?? DEFAULTS.version;
  let quill = args.quill ?? DEFAULTS.quill;
  const interactive = !args.yes && stdout.isTTY;

  if (interactive) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      if (name === null) name = await prompt(rl, 'Plugin name: ');
      if (displayName === null) displayName = await prompt(rl, 'Display name: ', name);
      if (author === '') author = await prompt(rl, 'Author (optional): ');
      version = await prompt(rl, 'Version: ', version);
      quill = await prompt(rl, 'Quill engine compat: ', quill);
    } finally {
      rl.close();
    }
  }

  if (!name) {
    console.error('Plugin name is required. Pass it positionally or via --name, or run interactively (TTY).');
    console.error(HELP);
    process.exit(1);
  }

  const id = toId(name);
  if (!id) {
    console.error(`✗ invalid plugin name: "${name}"`);
    process.exit(1);
  }
  const pkgName = id.startsWith('quill-plugin-') ? id : `quill-plugin-${id}`;
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
    ['__quill__', quill],
  ];
  const filesToRewrite = [
    'package.json',
    'manifest.json',
    'tsconfig.json',
    'build.mjs',
    'README.md',
    'src/index.ts',
  ];

  await cp(TEMPLATE_DIR, target, { recursive: true });
  for (const rel of filesToRewrite) {
    const p = join(target, rel);
    let s = await readFile(p, 'utf8');
    for (const [from, to] of placeholders) s = s.split(from).join(to);
    await writeFile(p, s);
  }

  console.log(`✓ created ${name}/`);
  console.log('');
  console.log('Next steps:');
  console.log(`  cd ${name}`);
  console.log('  pnpm install   # or: npm install');
  console.log('  pnpm build');
  console.log('');
  console.log('Then edit src/index.ts and manifest.json to add contributions.');
  console.log('See plugins/quill-plugin-plantuml for a working example.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
