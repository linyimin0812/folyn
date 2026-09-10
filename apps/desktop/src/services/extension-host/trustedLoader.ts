/**
 * Trusted-tier ExtensionLoader.
 *
 * Implements the `ExtensionLoader` interface for `tier: 'trusted'` extensions. On
 * `load()`, verifies the TOFU trust gate (user-pinned + integrity), fetches
 * the extension's `manifest.main` ESM bundle, wraps it in a blob URL, and
 * `import()`-s it into the host realm. The module's named exports are then
 * wired into the app's contribution registries (file-types / containers /
 * commands / features / tools) via the in-process adapters.
 *
 * ## Design reality (READ THIS)
 *
 * Trusted extensions run **in the MAIN webview realm**, which already has broad
 * Tauri capabilities from `capabilities/default.json`. The TOFU gate
 * (integrity + user-pin) is the *real* security boundary — once a extension is
 * `import()`-ed, it has full access to the host realm (Zustand stores, the
 * DOM, `@tauri-apps/api` with the main window's caps). This is the VSCode
 * "in-process host = soft consent gate" trade-off (research/
 * vscode-extension-host.md §3), explicitly accepted for the trusted tier:
 * TOFU-pinned = user explicitly trusted = full power. Do NOT pretend
 * `add_capability` (Rust `grant_extension_capabilities`) is a hard sandbox — it
 * is additive/redundant because the main window already has those caps.
 *
 * ## Hot unload
 *
 * ES module cache cannot be evicted (research/tauri-runtime-loading.md §6).
 * `deactivate` calls the extension's `deactivate()`, disposes all contribution
 * adapters (unregister file-types/containers/commands), and revokes the blob
 * URL. A **fresh blob URL per activation** allows re-activation with current
 * code: the old module becomes collectable once its disposable side effects
 * are removed and no references remain.
 *
 * ## Self-contained bundle requirement
 *
 * The extension's `main` must be a self-contained ESM bundle — relative imports
 * inside a blob URL do not resolve (the blob has no path). Remote imports are
 * blocked by the `folyn-extension://` CSP. The extension MUST bundle all deps.
 */

import type {
  Disposable,
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionLoader,
  ExtensionManifest,
} from '@folyn/extension-host';
import { disposable } from '@folyn/extension-host';
import type { ExtensionModule } from './contributionAdapters';
import {
  registerTrustedExtensionCommands,
  registerExtensionFileTypes,
  registerExtensionContainers,
} from './contributionAdapters';
import { registerExtensionTools } from './toolAdapter';
import { registerExtensionFeatures } from './featureAdapter';
import { registerExtensionExporters } from './exporterAdapter';
import { registerExtensionFileTemplates } from './fileTemplateAdapter';
import { registerExtensionKeybindings } from './keybindingAdapter';
import { registerExtensionExportEnhancers } from './exportEnhancerAdapter';
import { registerExtensionMarkdownCodeRenderers } from './markdownCodeRendererAdapter';
import { registerExtensionEditorLanguages } from './editorLanguageAdapter';
import { registerExtensionHighlightGrammars } from './highlightGrammarAdapter';

export const trustedLoader: ExtensionLoader = {
  tier: 'trusted',

  async load(manifest: ExtensionManifest): Promise<Extension> {
    // ── TOFU gate ──
    // The gate is enforced here (not just in Rust) so a tampered file is
    // refused before `import()` even runs. `get_extension_record` returns the
    // on-disk record with `trusted` + `integrity`.
    const record = await fetchExtensionRecord(manifest.id);
    if (!record.trusted) {
      throw new Error(
        `extension "${manifest.id}" is not trusted — call approve_extension first (TOFU gate)`,
      );
    }
    // Fetch the main bundle bytes.
    const code = await readExtensionFile(manifest.id, manifest.main);
    // Recompute the hash in JS and compare against stored integrity.
    const actualHash = await sha256Hex(code);
    const storedHash = record.integrity?.[manifest.main];
    if (!storedHash) {
      throw new Error(
        `extension "${manifest.id}": no stored integrity for "${manifest.main}" — refusing to load`,
      );
    }
    if (actualHash !== storedHash) {
      throw new Error(
        `extension "${manifest.id}": integrity check failed for "${manifest.main}" (expected ${storedHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…)`,
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

    // NOTE: no `grant_extension_capabilities` call. The Rust `add_capability`
    // grant is documented as additive/redundant (trusted extensions run in the
    // main webview, which already has `fs:scope: [{"path":"**"}]` and the rest
    // of `capabilities/default.json`), and its scoped-permission entry format
    // corrupts the runtime ACL — every later fs permission check then fails
    // with "error deserializing scope: … EntryRaw". Skipping it keeps the ACL
    // intact; the extension is unaffected because the main caps cover the surface.

    return {
      activate: async (api: ExtensionApi, ctx: ExtensionContext) => {
        // Wire contribution adapters. Each returns a Disposable; push them
        // all into the context so ExtensionHost reaps them on deactivate.
        // `registerExtensionContainers` is async (resolves `.svg` file-path icons
        // via read_extension_file before registering); the other adapters are sync.
        const containerDisp = await registerExtensionContainers(manifest, module);
        const adapterDisposables: Disposable[] = [
          registerTrustedExtensionCommands(manifest, module),
          registerExtensionFileTypes(manifest, module),
          containerDisp,
          registerExtensionTools(manifest),
          registerExtensionFeatures(manifest, module),
          registerExtensionExporters(manifest, module),
          registerExtensionFileTemplates(manifest),
          registerExtensionKeybindings(manifest),
          registerExtensionExportEnhancers(manifest, module),
          registerExtensionMarkdownCodeRenderers(manifest, module),
          registerExtensionEditorLanguages(manifest, module),
          registerExtensionHighlightGrammars(manifest, module),
        ];
        for (const d of adapterDisposables) ctx.addDisposable(d);

        // The blob-URL disposable: revoke after deactivate so the module can
        // be GC'd. Pushed here so it reaped in the same pass.
        ctx.addDisposable(
          disposable(() => {
            URL.revokeObjectURL(blobUrl);
          }),
        );

        // Call the extension's own activate hook if present, forwarding the
        // capability api + context unchanged.
        return module.activate?.(api, ctx);
      },
      deactivate: (ctx: ExtensionContext) => {
        // Call the extension's own deactivate hook first (while contributions
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
 * Normalize a raw `import()` result into a `ExtensionModule`. Unwraps a
 * `default` export if present, then copies the named extension exports
 * (`handlers`, `containers`, `features`, `commands`, `exporters`, `activate`,
 * `deactivate`) when they exist on the module namespace.
 */
function normalizeModule(mod: Record<string, unknown>): ExtensionModule {
  const out: ExtensionModule = {};
  const src = (mod.default ?? mod) as Record<string, unknown>;
  if (src.handlers) out.handlers = src.handlers as ExtensionModule['handlers'];
  if (src.containers) out.containers = src.containers as ExtensionModule['containers'];
  if (src.features) out.features = src.features as ExtensionModule['features'];
  if (src.commands) out.commands = src.commands as ExtensionModule['commands'];
  if (src.exporters) out.exporters = src.exporters as ExtensionModule['exporters'];
  if (src.exportEnhancers) out.exportEnhancers = src.exportEnhancers as ExtensionModule['exportEnhancers'];
  if (src.markdownCodeRenderers) out.markdownCodeRenderers = src.markdownCodeRenderers as ExtensionModule['markdownCodeRenderers'];
  if (src.editorLanguages) out.editorLanguages = src.editorLanguages as ExtensionModule['editorLanguages'];
  if (typeof src.activate === 'function') out.activate = src.activate as ExtensionModule['activate'];
  if (typeof src.deactivate === 'function') out.deactivate = src.deactivate as ExtensionModule['deactivate'];
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

/** Fetch the on-disk extension record (trusted flag + integrity map). */
export async function fetchExtensionRecord(
  id: string,
): Promise<{ trusted: boolean; integrity: Record<string, string> }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const record = await invoke<{ trusted: boolean; integrity: Record<string, string> }>(
    'get_extension_record',
    { id },
  );
  return record;
}

/** Read a extension file's contents as a UTF-8 string. */
export async function readExtensionFile(id: string, path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_extension_file', { id, path });
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
