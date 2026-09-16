// ponytail: end-to-end smoke check for the non-interactive path.
// Runs the built CLI in a temp dir with --yes + flags for BOTH tiers, asserts
// manifest/package.json placeholders substituted correctly and the per-tier
// files (trusted: React shims + alias; sandbox: index.html + RPC entry) are
// present. Run via `pnpm test`.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'dist', 'index.js');

function run(args, cwd) {
  execFileSync(process.execPath, [bin, ...args], { cwd, stdio: 'pipe' });
}

// ── Trusted tier ────────────────────────────────────────────────────────────
const dir = await mkdtemp(join(tmpdir(), 'create-folyn-extension-'));
try {
  run(['demo-extension', '--tier', 'trusted', '--yes',
    '--author', 'Jane', '--version', '1.2.3',
    '--folyn', '>=0.2.0', '--display-name', 'Demo Extension',
  ], dir);

  const manifest = JSON.parse(await readFile(join(dir, 'demo-extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'demo-extension');
  assert.equal(manifest.name, 'Demo Extension');
  assert.equal(manifest.author, 'Jane');
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.folyn, '>=0.2.0');
  assert.equal(manifest.tier, 'trusted');
  assert.equal(manifest.html, '');

  const pkg = JSON.parse(await readFile(join(dir, 'demo-extension', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'folyn-extension-demo-extension');
  assert.equal(pkg.version, '1.2.3');

  // Trusted gets the React shims + alias build.
  const buildMjs = await readFile(join(dir, 'demo-extension', 'build.mjs'), 'utf8');
  assert.match(buildMjs, /react-shim\.js/, 'trusted build.mjs aliases react to the shim');
  assert.match(buildMjs, /react-jsx-runtime-shim\.js/, 'trusted build.mjs aliases react/jsx-runtime');
  assert.match(buildMjs, /jsx: 'automatic'/, 'trusted build.mjs sets jsx: automatic');

  const shim = await readFile(join(dir, 'demo-extension', 'src', 'react-shim.js'), 'utf8');
  assert.match(shim, /window\.React/, 'react-shim reads window.React');
  const jsxShim = await readFile(join(dir, 'demo-extension', 'src', 'react-jsx-runtime-shim.js'), 'utf8');
  assert.match(jsxShim, /function jsx/, 'jsx-runtime shim provides jsx');

  // Shared files ship with the template (static, no placeholder substitution).
  const agents = await readFile(join(dir, 'demo-extension', 'AGENTS.md'), 'utf8');
  const claude = await readFile(join(dir, 'demo-extension', 'CLAUDE.md'), 'utf8');
  assert.ok(agents.length > 100, 'AGENTS.md should have real content');
  assert.match(claude, /See AGENTS\.md/, 'CLAUDE.md should point to AGENTS.md');

  console.log('OK: trusted tier smoke passed');
} finally {
  await rm(dir, { recursive: true, force: true });
}

// ── Sandbox tier ───────────────────────────────────────────────────────────
const dir2 = await mkdtemp(join(tmpdir(), 'create-folyn-extension-sb-'));
try {
  run(['sandbox-tool', '--tier', 'sandbox', '--yes',
    '--author', 'Jane', '--version', '1.2.3',
    '--folyn', '>=0.2.0', '--display-name', 'Sandbox Tool',
  ], dir2);

  const manifest = JSON.parse(await readFile(join(dir2, 'sandbox-tool', 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'sandbox-tool');
  assert.equal(manifest.name, 'Sandbox Tool');
  assert.equal(manifest.tier, 'sandbox');
  assert.equal(manifest.main, 'index.js');
  assert.equal(manifest.html, 'index.html');

  const pkg = JSON.parse(await readFile(join(dir2, 'sandbox-tool', 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'folyn-extension-sandbox-tool');
  assert.ok(!('react' in (pkg.devDependencies ?? {})), 'sandbox package has no react devDep');

  // Sandbox gets index.html + postMessage RPC entry; NO React shims.
  const html = await readFile(join(dir2, 'sandbox-tool', 'src', 'index.html'), 'utf8');
  assert.match(html, /<script src="\.\/index\.js"/, 'sandbox index.html references ./index.js');
  const entry = await readFile(join(dir2, 'sandbox-tool', 'src', 'index.ts'), 'utf8');
  assert.match(entry, /postMessage/, 'sandbox entry wires the postMessage RPC bridge');

  const buildMjs = await readFile(join(dir2, 'sandbox-tool', 'build.mjs'), 'utf8');
  assert.match(buildMjs, /format: 'iife'/, 'sandbox build.mjs emits IIFE');
  assert.doesNotMatch(buildMjs, /react-shim/, 'sandbox build.mjs has no react shim alias');

  // Shared files identical across tiers.
  const agents = await readFile(join(dir2, 'sandbox-tool', 'AGENTS.md'), 'utf8');
  assert.ok(agents.length > 100, 'AGENTS.md should have real content');

  console.log('OK: sandbox tier smoke passed');
} finally {
  await rm(dir2, { recursive: true, force: true });
}

// ── --tier is required (non-interactive without it errors) ────────────────
{
  const dir3 = await mkdtemp(join(tmpdir(), 'create-folyn-extension-no-tier-'));
  try {
    let threw = false;
    try {
      run(['no-tier', '--yes', '--author', 'Jane'], dir3);
    } catch (e) {
      threw = true;
      const stderr = (e.stderr || '').toString();
      assert.match(stderr, /--tier|tier is required/, 'should error about missing tier');
    }
    assert.ok(threw, 'non-interactive run without --tier should fail');
    console.log('OK: --tier required (non-interactive)');
  } finally {
    await rm(dir3, { recursive: true, force: true });
  }
}

// ── build.mjs manifest rewrite logic (trusted: dist/index.js → index.js) ───
{
  const templateManifest = JSON.parse(
    await readFile(join(here, '..', 'template', 'trusted', 'manifest.json'), 'utf8')
  );
  const rewritten = templateManifest.main.replace(/^dist\//, '');
  assert.equal(rewritten, 'index.js', 'trusted manifest.main should rewrite to index.js inside dist/');
  console.log('OK: trusted build.mjs manifest rewrite checked');
}

// ── sandbox manifest is already dist-relative (no rewrite) ─────────────────
{
  const templateManifest = JSON.parse(
    await readFile(join(here, '..', 'template', 'sandbox', 'manifest.json'), 'utf8')
  );
  assert.equal(templateManifest.main, 'index.js', 'sandbox manifest.main is dist-relative');
  assert.equal(templateManifest.html, 'index.html', 'sandbox manifest.html is dist-relative');
  console.log('OK: sandbox manifest main/html checked');
}
