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

import {
  disposable,
  getContributionAdapters,
} from '@folyn/extension-host';
import type {
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionLoader,
  ExtensionManifest,
  ExtensionModule,
} from '@folyn/extension-host';
// Side-effect: load + self-register all trusted contribution adapters.
// `activate` folds over getContributionAdapters(); normalizeModule pulls their
// declared moduleKeys. Adding an adapter = one line in trustedContributions.ts.
import './trustedContributions';

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
        // Fold over registered contribution adapters (registry seam — see
        // trustedContributions.ts). Each returns a Disposable (sync or async;
        // containers resolves `.svg` icons first); pushed into the context so
        // ExtensionHost reaps them on deactivate. Adapters are independent, so
        // order is not load-bearing (mirrors the prior list for parity).
        for (const adapter of getContributionAdapters()) {
          ctx.addDisposable(await adapter.register(manifest, module));
        }

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
 * `default` export if present, then copies the export maps declared by
 * registered contribution adapters (via their `moduleKey`) plus the
 * `activate`/`deactivate` lifecycle hooks when present. Data-driven: no
 * hand-written per-map branches — see trustedContributions.ts.
 */
function normalizeModule(mod: Record<string, unknown>): ExtensionModule {
  const src = (mod.default ?? mod) as Record<string, unknown>;
  // Data-driven: pull only the module maps declared by registered contribution
  // adapters (via their `moduleKey`). No hand-written per-map branches — adding
  // a contribution point with a new map key only needs the adapter to declare it.
  const out: Record<string, unknown> = {};
  for (const adapter of getContributionAdapters()) {
    if (adapter.moduleKey && src[adapter.moduleKey] !== undefined) {
      out[adapter.moduleKey] = src[adapter.moduleKey];
    }
  }
  if (typeof src.activate === 'function') out.activate = src.activate;
  if (typeof src.deactivate === 'function') out.deactivate = src.deactivate;
  return out as ExtensionModule;
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
