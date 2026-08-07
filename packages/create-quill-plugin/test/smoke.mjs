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
  execFileSync(process.execPath, [bin, 'demo-plugin', '--yes', '--author', 'Jane'], {
    cwd: dir,
    stdio: 'pipe',
  });

  const manifest = JSON.parse(await readFile(join(dir, 'demo-plugin', 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'demo-plugin');
  assert.equal(manifest.name, 'demo-plugin');
  assert.equal(manifest.author, 'Jane');

  const pkg = JSON.parse(await readFile(join(dir, 'demo-plugin', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'quill-plugin-demo-plugin');

  console.log('OK: smoke test passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}
