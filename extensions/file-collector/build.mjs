import esbuild from 'esbuild';
import { hostModules } from 'folyn-extension-sdk/build';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Trusted-tier bundle: a self-contained ESM file the host blob-imports. React
// is NOT bundled — the settings form uses the host's instance (hostModules).
// The form is styled with the host's Tailwind classes; the host's
// tailwind.config.js scans `extensions/*/src` so they exist in its CSS.
await mkdir(path.join(root, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostModules(),
  minify: true,
  logLevel: 'warning',
});
console.log('host bundle → dist/index.js');

// Self-contained installable manifest (source manifest stays in src/ so the
// repo root is not installable — mirrors carousel/rich-text).
const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Settings → Extensions → Install from folder…');
