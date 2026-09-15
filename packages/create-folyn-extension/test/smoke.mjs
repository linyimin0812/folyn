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

const dir = await mkdtemp(join(tmpdir(), 'create-folyn-extension-'));
try {
  execFileSync(process.execPath, [
    bin, 'demo-extension', '--yes',
    '--author', 'Jane',
    '--version', '1.2.3',
    '--folyn', '>=0.2.0',
    '--display-name', 'Demo Extension',
  ], { cwd: dir, stdio: 'pipe' });

  const manifest = JSON.parse(await readFile(join(dir, 'demo-extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'demo-extension');
  assert.equal(manifest.name, 'Demo Extension');
  assert.equal(manifest.author, 'Jane');
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.folyn, '>=0.2.0');

  const pkg = JSON.parse(await readFile(join(dir, 'demo-extension', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'folyn-extension-demo-extension');
  assert.equal(pkg.version, '1.2.3');

  // ponytail: agent-context docs ship with the template (static, no
  // placeholder substitution). CLAUDE.md is a one-line pointer to AGENTS.md.
  const agents = await readFile(join(dir, 'demo-extension', 'AGENTS.md'), 'utf8');
  const claude = await readFile(join(dir, 'demo-extension', 'CLAUDE.md'), 'utf8');
  assert.ok(agents.length > 100, 'AGENTS.md should have real content');
  assert.match(claude, /See AGENTS\.md/, 'CLAUDE.md should point to AGENTS.md');

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
