import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Host bundle only — the Carousel renders inline in the host React tree
// (slides are plain React nodes), so there's no separate origin like
// file-viewer's iframe. React is aliased to a shim reading window.React
// (one instance shared with the host — the established trusted-tier pattern).
const shim = path.join(root, 'src/react-shim.js');
const hostAlias = {
  react: shim,
  'react/jsx-runtime': path.join(root, 'src/react-jsx-runtime-shim.js'),
};

await mkdir(path.join(root, 'dist'), { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostAlias,
  minify: true,
  logLevel: 'warning',
});
console.log('host bundle → dist/index.js');

// Self-contained installable manifest. The SOURCE manifest lives in src/
// (never at the extension root — that keeps the repo root un-installable, so
// picking it in "install from folder" fails with a clear manifest error
// instead of silently loading unbuilt assets). Mirrors rich-text.
const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Settings → Containers → Install from folder…');
