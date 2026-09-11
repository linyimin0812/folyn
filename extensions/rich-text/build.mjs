import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// ponytail: Phase 2 stub — host bundle only. No vite iframe bundle (rich-text
// renders inline in the host React tree via NodeView; no separate origin).
// No tailwind/postcss — StubEditor uses host CSS classes (text-t2, p-4) that
// resolve via the host stylesheet. Phase 3 adds vite/tailwind when
// RichTextEditor + its own styles move in.
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

const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Plugins → Install from folder…');
