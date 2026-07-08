/**
 * Smoke test for the example plugins (PR4).
 *
 * Validates that the two sample plugins in `examples/plugins/` have manifests
 * that pass `PluginHost.validateManifest`, and that the trusted sample's
 * `index.js` is a loadable ESM module whose named exports match the
 * `PluginModule` contract (containers/commands/activate/deactivate).
 *
 * We do NOT execute the sample (it needs the Rust `quill-plugin://` scheme +
 * real fs); we only assert the manifest parses and the module's exports have
 * the right shape. The trusted sample is pure ESM with no top-level bare
 * imports, so `import()` of the file path works in vitest without the Tauri
 * layer. The sandbox sample needs the scheme to actually run (its index.js is
 * an iframe script, not an ESM module), so we only validate its manifest.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PluginHost } from './PluginHost';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-host/src/ → examples/plugins/
const EXAMPLES_DIR = path.resolve(__dirname, '../../../examples/plugins');

function readManifest(pluginId: string): Record<string, unknown> {
  const manifestPath = path.join(EXAMPLES_DIR, pluginId, 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
}

describe('example plugins / manifest validation', () => {
  it('hello-tool manifest validates (sandbox tier)', () => {
    const host = new PluginHost();
    const manifest = readManifest('hello-tool');
    expect(() => host.validateManifest(manifest as never)).not.toThrow();
  });

  it('markdown-todo manifest validates (trusted tier)', () => {
    const host = new PluginHost();
    const manifest = readManifest('markdown-todo');
    expect(() => host.validateManifest(manifest as never)).not.toThrow();
  });

  it('hello-tool manifest declares a command + tool + clipboard permission', () => {
    const manifest = readManifest('hello-tool');
    expect(manifest.tier).toBe('sandbox');
    expect(manifest.html).toBe('index.html');
    const contributes = manifest.contributes as Record<string, unknown[]>;
    expect(contributes.commands).toHaveLength(1);
    expect((contributes.commands[0] as { id: string }).id).toBe('greet');
    expect(contributes.tools).toHaveLength(1);
    expect((manifest.permissions as { clipboard: boolean }).clipboard).toBe(true);
  });

  it('markdown-todo manifest declares a container + command (trusted)', () => {
    const manifest = readManifest('markdown-todo');
    expect(manifest.tier).toBe('trusted');
    expect(manifest.main).toBe('index.js');
    const contributes = manifest.contributes as Record<string, unknown[]>;
    expect(contributes.containers).toHaveLength(1);
    expect((contributes.containers[0] as { name: string }).name).toBe('todo');
    expect(contributes.commands).toHaveLength(1);
    expect((contributes.commands[0] as { id: string }).id).toBe('insert-todo');
  });
});

describe('example plugins / markdown-todo module exports', () => {
  it('exports containers + commands + activate/deactivate matching PluginModule', async () => {
    // Dynamic-import the trusted sample's index.js. It's pure ESM with no
    // top-level bare imports (React + store are lazy-imported inside funcs),
    // so this resolves in vitest without the Tauri layer.
    const modPath = path.join(EXAMPLES_DIR, 'markdown-todo', 'index.js');
    const modUrl = pathToFileUrl(modPath);
    const mod = (await import(modUrl)) as Record<string, unknown>;

    expect(typeof mod.containers).toBe('object');
    expect(mod.containers).not.toBeNull();
    const containers = mod.containers as Record<string, unknown>;
    expect(typeof containers.todo).toBe('function');

    expect(typeof mod.commands).toBe('object');
    expect(mod.commands).not.toBeNull();
    const commands = mod.commands as Record<string, unknown>;
    expect(typeof commands['insert-todo']).toBe('function');

    expect(typeof mod.activate).toBe('function');
    expect(typeof mod.deactivate).toBe('function');
  });
});

// Node 20+ exposes `pathToFileUrl` in `node:url`. Re-export to avoid a second
// import line above (keeps the dynamic-import URL construction readable).
function pathToFileUrl(p: string): string {
  // `import.meta.url` is a file:// URL; resolve the target the same way.
  return new URL(p, import.meta.url).href;
}
