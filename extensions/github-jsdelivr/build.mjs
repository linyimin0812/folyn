import esbuild from 'esbuild';
import { hostModules } from 'folyn-extension-sdk/build';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// ponytail: single-file ESM bundle. React is NOT bundled — the config form
// uses the host's instance (hostModules), so there is one React (no
// "Invalid hook call").
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/index.js',
  target: 'es2022',
  jsx: 'automatic',
  alias: hostModules(),
  minify: true,
  logLevel: 'info',
});

await mkdir('dist', { recursive: true });
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
manifest.main = manifest.main.replace(/^dist\//, '');
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log('built dist/ — pick this folder in Folyn → Extensions → Install from folder…');
