/**
 * Trusted-tier ExtensionLoader.
 *
 * Implements the `ExtensionLoader` interface for `tier: 'trusted'` plugins. On
 * `load()`, verifies the TOFU trust gate (user-pinned + integrity), fetches
 * the plugin's `manifest.main` ESM bundle, wraps it in a blob URL, and
 * `import()`-s it into the host realm. The module's named exports are then
 * wired into the app's contribution registries (file-types / containers /
 * commands / features / tools) via the in-process adapters.
 *
 * ## Design reality (READ THIS)
 *
 * Trusted plugins run **in the MAIN webview realm**, which already has broad
 * Tauri capabilities from `capabilities/default.json`. The TOFU gate
 * (integrity + user-pin) is the *real* security boundary — once a plugin is
 * `import()`-ed, it has full access to the host realm (Zustand stores, the
 * DOM, `@tauri-apps/api` with the main window's caps). This is the VSCode
 * "in-process host = soft consent gate" trade-off (research/
 * vscode-extension-host.md §3), explicitly accepted for the trusted tier:
 * TOFU-pinned = user explicitly trusted = full power. Do NOT pretend
 * `add_capability` (Rust `grant_plugin_capabilities`) is a hard sandbox — it
 * is additive/redundant because the main window already has those caps.
 *
 * ## Hot unload
 *
 * ES module cache cannot be evicted (research/tauri-runtime-loading.md §6).
 * `deactivate` calls the plugin's `deactivate()`, disposes all contribution
 * adapters (unregister file-types/containers/commands), and revokes the blob
 * URL. A **fresh blob URL per activation** allows re-activation with current
 * code: the old module becomes collectable once its disposable side effects
 * are removed and no references remain.
 *
 * ## Self-contained bundle requirement
 *
 * The plugin's `main` must be a self-contained ESM bundle — relative imports
 * inside a blob URL do not resolve (the blob has no path). Remote imports are
 * blocked by the `folyn-plugin://` CSP. The plugin MUST bundle all deps.
 */

import type {
  Disposable,
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionLoader,
  PluginManifest,
} from '@folyn/extension-host';
import { disposable } from '@folyn/extension-host';
import type { PluginModule } from './contributionAdapters';
import {
  registerTrustedPluginCommands,
  registerPluginFileTypes,
  registerPluginContainers,
} from './contributionAdapters';
import { registerPluginTools } from './toolAdapter';
import { registerPluginFeatures } from './featureAdapter';
import { registerPluginExporters } from './exporterAdapter';
import { registerPluginFileTemplates } from './fileTemplateAdapter';
import { registerPluginKeybindings } from './keybindingAdapter';
import { registerPluginExportEnhancers } from './exportEnhancerAdapter';
import { registerPluginMarkdownCodeRenderers } from './markdownCodeRendererAdapter';
import { registerPluginEditorLanguages } from './editorLanguageAdapter';
import { registerPluginHighlightGrammars } from './highlightGrammarAdapter';

export const trustedLoader: ExtensionLoader = {
  tier: 'trusted',

  async load(manifest: PluginManifest): Promise<Extension> {
    // ── TOFU gate ──
    // The gate is enforced here (not just in Rust) so a tampered file is
    // refused before `import()` even runs. `get_plugin_record` returns the
    // on-disk record with `trusted` + `integrity`.
    const record = await fetchPluginRecord(manifest.id);
    if (!record.trusted) {
      throw new Error(
        `plugin "${manifest.id}" is not trusted — call approve_plugin first (TOFU gate)`,
      );
    }
    // Fetch the main bundle bytes.
    const code = await readPluginFile(manifest.id, manifest.main);
    // Recompute the hash in JS and compare against stored integrity.
    const actualHash = await sha256Hex(code);
    const storedHash = record.integrity?.[manifest.main];
    if (!storedHash) {
      throw new Error(
        `plugin "${manifest.id}": no stored integrity for "${manifest.main}" — refusing to load`,
      );
    }
    if (actualHash !== storedHash) {
      throw new Error(
        `plugin "${manifest.id}": integrity check failed for "${manifest.main}" (expected ${storedHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…)`,
      );
    }

    // ── Blob-URL import ──
    // Wrap the fetched JS in a same-origin blob URL so the webview's native
    // `import()` loads it without CORS/file:// restrictions. A fresh blob URL
    // per activation allows re-activation with updated code (the old module
    // becomes collectable once side effects are disposed).
    const blob = new Blob([code], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const mod = await importModule(blobUrl);
    const module = normalizeModule(mod);

    // NOTE: no `grant_plugin_capabilities` call. The Rust `add_capability`
    // grant is documented as additive/redundant (trusted plugins run in the
    // main webview, which already has `fs:scope: [{"path":"**"}]` and the rest
    // of `capabilities/default.json`), and its scoped-permission entry format
    // corrupts the runtime ACL — every later fs permission check then fails
    // with "error deserializing scope: … EntryRaw". Skipping it keeps the ACL
    // intact; the plugin is unaffected because the main caps cover the surface.

    return {
      activate: async (api: ExtensionApi, ctx: ExtensionContext) => {
        // Wire contribution adapters. Each returns a Disposable; push them
        // all into the context so ExtensionHost reaps them on deactivate.
        // `registerPluginContainers` is async (resolves `.svg` file-path icons
        // via read_plugin_file before registering); the other adapters are sync.
        const containerDisp = await registerPluginContainers(manifest, module);
        const adapterDisposables: Disposable[] = [
          registerTrustedPluginCommands(manifest, module),
          registerPluginFileTypes(manifest, module),
          containerDisp,
          registerPluginTools(manifest),
          registerPluginFeatures(manifest, module),
          registerPluginExporters(manifest, module),
          registerPluginFileTemplates(manifest),
          registerPluginKeybindings(manifest),
          registerPluginExportEnhancers(manifest, module),
          registerPluginMarkdownCodeRenderers(manifest, module),
          registerPluginEditorLanguages(manifest, module),
          registerPluginHighlightGrammars(manifest, module),
        ];
        for (const d of adapterDisposables) ctx.addDisposable(d);

        // The blob-URL disposable: revoke after deactivate so the module can
        // be GC'd. Pushed here so it reaped in the same pass.
        ctx.addDisposable(
          disposable(() => {
            URL.revokeObjectURL(blobUrl);
          }),
        );

        // Call the plugin's own activate hook if present, forwarding the
        // capability api + context unchanged.
        return module.activate?.(api, ctx);
      },
      deactivate: (ctx: ExtensionContext) => {
        // Call the plugin's own deactivate hook first (while contributions
        // are still registered, so it can do cleanup that references them).
        return module.deactivate?.(ctx);
        // Contribution disposables + blob-URL revoke are reaped by ExtensionHost
        // immediately after this call returns.
      },
    };
  },
};

// ── Module resolution helpers ────────────────────────────────────────────────

/**
 * Normalize a raw `import()` result into a `PluginModule`. Unwraps a
 * `default` export if present, then copies the named plugin exports
 * (`handlers`, `containers`, `features`, `commands`, `exporters`, `activate`,
 * `deactivate`) when they exist on the module namespace.
 */
function normalizeModule(mod: Record<string, unknown>): PluginModule {
  const out: PluginModule = {};
  const src = (mod.default ?? mod) as Record<string, unknown>;
  if (src.handlers) out.handlers = src.handlers as PluginModule['handlers'];
  if (src.containers) out.containers = src.containers as PluginModule['containers'];
  if (src.features) out.features = src.features as PluginModule['features'];
  if (src.commands) out.commands = src.commands as PluginModule['commands'];
  if (src.exporters) out.exporters = src.exporters as PluginModule['exporters'];
  if (src.exportEnhancers) out.exportEnhancers = src.exportEnhancers as PluginModule['exportEnhancers'];
  if (src.markdownCodeRenderers) out.markdownCodeRenderers = src.markdownCodeRenderers as PluginModule['markdownCodeRenderers'];
  if (src.editorLanguages) out.editorLanguages = src.editorLanguages as PluginModule['editorLanguages'];
  if (typeof src.activate === 'function') out.activate = src.activate as PluginModule['activate'];
  if (typeof src.deactivate === 'function') out.deactivate = src.deactivate as PluginModule['deactivate'];
  return out;
}

/**
 * The native `import()` of a blob URL. Isolated so tests can inject a fake
 * module resolver via {@link setModuleResolver}.
 */
type ModuleResolver = (url: string) => Promise<Record<string, unknown>>;

let moduleResolver: ModuleResolver = (url) =>
  import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>;

/** Test hook: inject a fake module resolver to avoid real `import()`. */
export function setModuleResolver(resolver: ModuleResolver): void {
  moduleResolver = resolver;
}

async function importModule(url: string): Promise<Record<string, unknown>> {
  return moduleResolver(url);
}

// ── Tauri call wrappers (thin; mocked in tests via vi.mock or injection) ─────

/** Fetch the on-disk plugin record (trusted flag + integrity map). */
export async function fetchPluginRecord(
  id: string,
): Promise<{ trusted: boolean; integrity: Record<string, string> }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const record = await invoke<{ trusted: boolean; integrity: Record<string, string> }>(
    'get_plugin_record',
    { id },
  );
  return record;
}

/** Read a plugin file's contents as a UTF-8 string. */
export async function readPluginFile(id: string, path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_plugin_file', { id, path });
}

// ── SHA-256 (Web Crypto) ─────────────────────────────────────────────────────

/** Compute the SHA-256 hex digest of a string using the Web Crypto API. */
export async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hashBuffer);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
