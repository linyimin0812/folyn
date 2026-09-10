import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ponytail: single-file ESM bundle. All deps are inlined. React is NOT
// bundled — the plugin resolves window.React at runtime (host exposes it
// in main.tsx before any trusted plugin is import()-ed).
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/index.js',
  target: 'es2022',
  external: [],
  logLevel: 'info',
});

// Assemble `dist/` as a self-contained installable directory: copy the
// root manifest in and strip the leading `dist/` from `main` so it
// resolves relative to the dist root. Users can then pick `dist/`
// directly in Plugins → Install from folder… — no src/configs mixed in.
await mkdir('dist', { recursive: true });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log('built dist/ — pick this folder in Plugins → Install from folder…');
