import esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundle the extension to a single self-contained ESM.
 *
 * - `react` / `react/jsx-runtime` alias to shims reading the host's
 *   `window.React` (one React instance; two break hooks).
 * - Every @file-viewer/* renderer is inlined (local npm deps, no CDN fetch).
 * - Node built-ins pulled in by a couple of renderer deps (xmind-parser,
 *   ag-psd) alias to a browser shim — those Node-only paths aren't reached in
 *   the browser, but the imports must resolve.
 */
const alias = {
  react: path.join(root, 'src/react-shim.js'),
  'react/jsx-runtime': path.join(root, 'src/react-jsx-runtime-shim.js'),
  'fs/promises': path.join(root, 'src/shims/node-empty.js'),
  fs: path.join(root, 'src/shims/node-empty.js'),
  util: path.join(root, 'src/shims/node-empty.js'),
  zlib: path.join(root, 'src/shims/node-empty.js'),
  events: path.join(root, 'src/shims/node-empty.js'),
  stream: path.join(root, 'src/shims/node-empty.js'),
  path: path.join(root, 'src/shims/node-empty.js'),
  os: path.join(root, 'src/shims/node-empty.js'),
  crypto: path.join(root, 'src/shims/node-empty.js'),
  assert: path.join(root, 'src/shims/node-empty.js'),
  buffer: path.join(root, 'src/shims/node-empty.js'),
  url: path.join(root, 'src/shims/node-empty.js'),
  child_process: path.join(root, 'src/shims/node-empty.js'),
};

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.wasm': 'binary' },
  alias,
  minify: true,
  logLevel: 'info',
});

// Assemble `dist/` as a self-contained installable directory (manifest + bundle).
await mkdir(path.join(root, 'dist'), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install this folder in Folyn → Plugins → Install from folder…');
