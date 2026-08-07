#!/usr/bin/env node
import { cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(here, '..', 'template');

const rawName = process.argv[2];
if (!rawName) {
  console.error('Usage: npx create-quill-plugin <name>');
  process.exit(1);
}

// ponytail: slug-style id from the user-provided name. Lowercase, dashes only.
// No shell quoting needed — only used as a directory name and string replacement.
const id = rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
if (!id) {
  console.error(`✗ invalid plugin name: "${rawName}"`);
  process.exit(1);
}
const pkgName = id.startsWith('quill-plugin-') ? id : `quill-plugin-${id}`;
const target = resolve(process.cwd(), rawName);

if (existsSync(target)) {
  console.error(`✗ ${target} already exists`);
  process.exit(1);
}

const placeholders: [string, string][] = [
  ['__id__', id],
  ['__pkgName__', pkgName],
  ['__Name__', rawName],
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

console.log(`✓ created ${rawName}/`);
console.log('');
console.log('Next steps:');
console.log(`  cd ${rawName}`);
console.log('  pnpm install   # or: npm install');
console.log('  pnpm build');
console.log('');
console.log('Then edit src/index.ts and manifest.json to add contributions.');
console.log('See plugins/quill-plugin-plantuml for a working example.');
