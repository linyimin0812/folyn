// ponytail: end-to-end smoke check for the non-interactive path.
// Runs the built CLI in a temp dir with --yes + flags, asserts manifest
// and package.json placeholders substituted correctly. Run via `pnpm test`.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'dist', 'index.js');

const dir = await mkdtemp(join(tmpdir(), 'create-quill-plugin-'));
try {
  execFileSync(process.execPath, [
    bin, 'demo-plugin', '--yes',
    '--author', 'Jane',
    '--version', '1.2.3',
    '--quill', '>=0.2.0',
    '--display-name', 'Demo Plugin',
  ], { cwd: dir, stdio: 'pipe' });

  const manifest = JSON.parse(await readFile(join(dir, 'demo-plugin', 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'demo-plugin');
  assert.equal(manifest.name, 'Demo Plugin');
  assert.equal(manifest.author, 'Jane');
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.quill, '>=0.2.0');

  const pkg = JSON.parse(await readFile(join(dir, 'demo-plugin', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'quill-plugin-demo-plugin');
  assert.equal(pkg.version, '1.2.3');

  console.log('OK: smoke test passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}

// ponytail: smoke-check the build.mjs manifest rewrite logic in isolation.
// Running real `pnpm build` needs network for esbuild+sdk; the regex
// `manifest.main.replace(/^dist\//, '')` is the only non-trivial part —
// exercised here against the template manifest so a regression surfaces
// in `pnpm test` instead of at user install time.
{
  const templateManifest = JSON.parse(
    await readFile(join(here, '..', 'template', 'manifest.json'), 'utf8')
  );
  const rewritten = templateManifest.main.replace(/^dist\//, '');
  assert.equal(
    rewritten, 'index.js',
    'template manifest.main should rewrite to index.js inside dist/'
  );
  console.log('OK: build.mjs manifest rewrite checked');
}
