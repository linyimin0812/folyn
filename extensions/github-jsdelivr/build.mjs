import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// ponytail: single-file ESM bundle. React is NOT bundled — the config form
// resolves window.React at runtime (host exposes it in main.tsx before any
// trusted extension is import()-ed), so there's one React instance (no
// "Invalid hook call"). Same shim pattern as the dbml extension.
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'dist/index.js',
  target: 'es2022',
  alias: {
    react: path.join(root, 'src/react-shim.js'),
    'react/jsx-runtime': path.join(root, 'src/react-jsx-runtime-shim.js'),
  },
  minify: true,
  logLevel: 'info',
});

await mkdir('dist', { recursive: true });
const manifest = JSON.parse(await readFile('src/manifest.json', 'utf8'));
manifest.main = manifest.main.replace(/^dist\//, '');
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log('built dist/ — pick this folder in Folyn → Extensions → Install from folder…');
