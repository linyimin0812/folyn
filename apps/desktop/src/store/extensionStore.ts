/**
 * Extension management UI store.
 *
 * Owns the React-facing state for the Settings → Extensions tab: the list of
 * installed extensions (refreshed from `list_extensions()`), the consent-prompt
 * modal state, install-from-folder progress, and per-extension action busy
 * flags. The source of truth for *installedness* lives on disk in
 * `extensions.json` (owned by the Rust `extension_commands` module); this store is
 * a read-through cache + UI orchestration layer.
 *
 * State management conventions (see `.trellis/spec/desktop/frontend/state-
 * management.md`): granular selectors, `getState()` for imperative code
 * (Tauri event listeners in App.tsx), no whole-store subscriptions.
 *
 * Lifecycle event listeners (`extension://installed` / `uninstalled` /
 * `approved`) are wired in `App.tsx`, not here — they call
 * `useExtensionStore.getState().refresh()` after mutating the on-disk registry
 * so every open Settings tab sees the latest state.
 */

import { create } from 'zustand';
import { isTauri } from '@/utils/platform';
import translationSvgText from '@/assets/icons/translation.svg?raw';

// ponytail: Tauri rejects with the serialized AppError {category, detail};
// String(obj) yields "[object Object]" and hides the cause. Pull `detail`
// when present, else fall back to String(e). Same shape as modelRegistryStore.
function fmtErr(e: unknown): string {
  return typeof e === 'object' && e && 'detail' in e
    ? String((e as { detail: unknown }).detail ?? e)
    : String(e);
}

/** Catalog source: the `folyn-extensions` repo (separate from the app repo).
 * Served via raw.githubusercontent.com so `fetch_url` (host-allowlisted)
 * can reach it — the webview can't fetch cross-origin directly. */
const CATALOG_URL =
  'https://raw.githubusercontent.com/linyimin0812/folyn-extensions/main/catalog.json';

/** A single entry in the remote extension catalog (store tab). Mirrors the
 * shape committed to `folyn-extensions/catalog.json`. `icon` uses the same
 * semantics as `manifest.icon` (inline SVG / emoji / ThemeIcon name) so the
 * store card reuses `ExtensionIcon`. */

/** A localized text field in the catalog: either a plain string (fallback for
 * all locales — fine for names that aren't translated, e.g. "DBML") or a
 * `{ locale: text }` object. Resolved by {@link pickCatalogText} using the
 * app's current locale → zh (app fallbackLng) → en → first available. */
export type LocalizedText = string | Record<string, string>;

/** Resolve a catalog text field to a string for the given locale. Falls back
 * to the app's `fallbackLng` (`zh`), then `en`, then the first available
 * translation — so a catalog entry that supplies only one locale still
 * renders. Returns `undefined` only when `field` itself is nullish. */
export function pickCatalogText(
  field: LocalizedText | undefined,
  locale: string,
): string | undefined {
  if (field == null) return undefined;
  if (typeof field === 'string') return field;
  return field[locale] ?? field.zh ?? field.en ?? Object.values(field)[0];
}

export interface CatalogEntry {
  id: string;
  name: LocalizedText;
  version: string;
  description?: LocalizedText;
  tier: 'sandbox' | 'trusted';
  author?: string;
  icon?: string;
  /** Absolute `github.com/.../releases/download/<tag>/<id>-<ver>.zip` URL.
   * `install_extension_from_url` (Rust) restricts the host to github.com. */
  downloadUrl: string;
}

/** Module-level empty array so a `catalog` selector returning the not-loaded
 * state stays referentially stable (see state-management.md: selectors must
 * not mint a fresh `[]` on the empty path or useSyncExternalStore loops). */
const EMPTY_CATALOG: CatalogEntry[] = [];

/** Mirrors the Rust `ExtensionEntry` shape (extension_commands.rs). */
export interface ExtensionEntry {
  id: string;
  name: string;
  version: string;
  tier: 'sandbox' | 'trusted';
  /** TOFU trust flag — `true` after the user approves the extension. */
  trusted: boolean;
  /** relpath → SHA-256 hex, computed at install time. */
  integrity: Record<string, string>;
  /** Persisted user-facing activation flag. `false` means the user disabled
   * the extension in Settings — App.tsx hydrate skips activation on next
   * launch. In-memory host state is reset on restart, so this field is the
   * source of truth for "should this extension auto-activate on launch". */
  enabled: boolean;
}

/**
 * Runtime activation state, surfaced in the UI. The on-disk `ExtensionEntry`
 * has no `state` field (it only knows install/trust); the activation state
 * lives in the in-memory `ExtensionHost`. This enum is the merge of both used
 * for display.
 */
export type ExtensionUiState = 'installed' | 'active' | 'inactive' | 'failed';

/** Map the host's fine-grained {@link ExtensionState} onto the coarse UI state. */
function toUiState(s: string | undefined): ExtensionUiState {
  switch (s) {
    case 'active':
      return 'active';
    case 'failed':
      return 'failed';
    case 'validated':
    case 'disabled':
    case 'waiting':
    case 'deactivating':
      return 'inactive';
    default: // 'loading' | 'activating' | undefined → treat as installed/pending
      return 'installed';
  }
}

/** Display-facing row: the on-disk entry + the host's runtime state. */
export interface ExtensionRow {
  entry: ExtensionEntry;
  state: ExtensionUiState;
  /** Present when `state === 'failed'`, for diagnostics. */
  error?: string;
  /** Inline-SVG / emoji / ThemeIcon-name / short-text icon (resolved from
   * the manifest; a `.svg` path has already been fetched and inlined).
   * Undefined when the manifest declares no icon or the read failed. */
  icon?: string;
  /** One-line description from the manifest. */
  description?: string;
  /** True for built-in panels surfaced as extensions (Translation).
   * These rows have no on-disk entry — the toggle binds to appearanceStore
   * flags, and uninstall is hidden. */
  builtin?: boolean;
  /** i18n key for the display name (built-in rows). When present, the UI
   * renders `t(nameKey)` instead of `entry.name`. */
  nameKey?: string;
  /** i18n key for the description (built-in rows). */
  descKey?: string;
  /** Dark-mode variant of `icon` (raw SVG text). When present and the
   * resolved theme is dark, ExtensionIcon swaps to this instead of `icon`. */
  iconDark?: string;
}

/** Static definitions for the built-in panel "extensions". The flag/setter
 * are bound in the UI via appearanceStore, not here, to keep the store
 * decoupled from appearanceStore's hook shape.
 *
 * ponytail: translation listed FIRST so it surfaces at the top of the
 * Extensions settings page — translation is the only panel enabled by
 * default, so it should be the first thing visible. Order is render-order,
 * not feature-priority. */
export const BUILTIN_PANEL_DEFS = [
  { id: 'builtin:translation', nameKey: 'settings:appearance.panels.translation.label', descKey: 'settings:appearance.panels.translation.description', flag: 'enableTranslationPanel' as const },
] as const;

/** Consent-prompt modal state. */
export interface ConsentPrompt {
  /** Extension id being approved. */
  id: string;
  /** Extension display name. */
  name: string;
  /** Human-readable summary of declared permissions (parsed from manifest). */
  permissions: string[];
}

/**
 * A render error captured by `PanelErrorBoundary` wrapping a extension surface.
 * Surfaced in Settings → Extensions so a third-party extension that throws during
 * render shows a ⚠ badge + last message instead of silently white-screening.
 */
export interface RenderError {
  message: string;
  /** Diagnostics label naming the broken surface, e.g. "file-type:dbml:editor". */
  label: string;
  /** Capture time (ms epoch). */
  ts: number;
}

/** Per-extension cap so a render-error spam loop can't grow memory unbounded. */
const MAX_RENDER_ERRORS = 20;

interface ExtensionState {
  rows: ExtensionRow[];
  /** True while `refresh()` is in flight. */
  refreshing: boolean;
  /** True while an install-from-folder is in flight. */
  installing: false | { id: string; sourcePath: string };
  /** Per-extension action busy flags, keyed by `${id}:${action}`. */
  busy: Record<string, boolean>;
  /** Last error surfaced to the UI (install/activate/etc.). */
  error: string;
  /** Consent-prompt modal. `null` when closed. */
  consent: ConsentPrompt | null;
  /**
   * Per-extension render errors captured by `PanelErrorBoundary`, keyed by
   * extensionId. Capped at {@link MAX_RENDER_ERRORS} per extension. Presence of an
   * entry means a extension surface threw during render — the host isolated it,
   * but the user should see *something* errored in Settings.
   */
  renderErrors: Record<string, RenderError[]>;

  // ── Actions ──
  refresh: () => Promise<void>;
  installFromFolder: (sourcePath: string) => Promise<void>;
  installFromZip: (filePath: string) => Promise<void>;
  approve: (id: string) => Promise<void>;
  activate: (id: string) => Promise<void>;
  deactivate: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  openConsent: (id: string) => Promise<void>;
  closeConsent: () => void;
  clearError: () => void;
  /** Record a render error thrown by a extension surface (called by the boundary). */
  recordRenderError: (extensionId: string, e: { message: string; label: string }) => void;
  /** Clear the render-error log for a extension (Settings "clear" button). */
  clearRenderErrors: (extensionId: string) => void;

  // ── Store (catalog) ──
  /** Remote catalog entries (store tab). `[]` until `fetchCatalog()` loads. */
  catalog: CatalogEntry[];
  /** True while `fetchCatalog()` is in flight. */
  catalogLoading: boolean;
  /** Last catalog-load error surfaced to the store tab. */
  catalogError: string;
  /** Fetch the remote catalog via `fetch_url` (host-allowlisted to
   * raw.githubusercontent.com). */
  fetchCatalog: () => Promise<void>;
  /** Download + install a catalog entry via `install_extension_from_url`.
   * The `extension://installed` event listener in App.tsx installs the
   * manifest into the in-memory host + activates sandbox extensions; this
   * action then refreshes so the store card flips to "Installed". */
  installFromUrl: (entry: CatalogEntry) => Promise<void>;
  /** Download + install a zip from a raw URL (the "install from URL" path —
   * point-to-point sharing that bypasses the catalog). The id is resolved
   * from the zip's manifest by the Rust side (empty `id` arg), so the
   * caller supplies only the URL. Used by the Store tab's URL input. */
  installFromRawUrl: (url: string) => Promise<void>;
}

/**
 * Contribution kinds that carry an icon, in display-priority order. Used to
 * derive a extension's row icon when the manifest has no top-level `icon`.
 */
const ICON_CONTRIBUTION_KEYS = [
  'features',
  'tools',
  'containers',
  'commands',
  'fileTemplates',
] as const;

/**
 * Resolve the icon string to show for a extension's settings row: the top-level
 * `manifest.icon` wins; otherwise fall back to the first non-empty icon
 * declared by any contribution point (features → tools → containers →
 * commands → fileTemplates). Sample extensions ship their identity icon in
 * `contributes.*.icon`, so without this fallback the settings row would show
 * a bare first-letter avatar.
 */
export function resolveManifestIcon(manifest: {
  icon?: string;
  contributes?: Partial<
    Record<(typeof ICON_CONTRIBUTION_KEYS)[number], Array<{ icon?: string }>>
  >;
}): string | undefined {
  if (manifest.icon && manifest.icon.trim().length > 0) return manifest.icon;
  for (const key of ICON_CONTRIBUTION_KEYS) {
    const items = manifest.contributes?.[key];
    if (!items) continue;
    const hit = items.find((item) => item.icon && item.icon.trim().length > 0);
    if (hit?.icon) return hit.icon;
  }
  return undefined;
}

/** Pull the host's runtime extension records into display rows. */
async function fetchRows(): Promise<ExtensionRow[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const entries = await invoke<ExtensionEntry[]>('list_extensions');
  // Lazy-import the extensionHost so this store stays decoupled at module load.
  const { extensionHost } = await import("@folyn/extension-host");
  // Lazy-import appearanceStore to read the built-in panel flags without
  // creating a hard module-cycle (appearanceStore doesn't import extensionStore).
  const { useAppearanceStore } = await import('@/store/appearanceStore');
  const appearance = useAppearanceStore.getState();
  const builtinRows: ExtensionRow[] = BUILTIN_PANEL_DEFS.map((def) => ({
    entry: {
      id: def.id,
      name: def.id,
      version: '—',
      tier: 'sandbox',
      trusted: true,
      integrity: {},
      enabled: true,
    },
    state: appearance[def.flag] ? 'active' : 'inactive',
    builtin: true,
    nameKey: def.nameKey,
    descKey: def.descKey,
    icon: def.id === 'builtin:translation' ? translationSvgText : undefined,
  }));
  // Best-effort: fetch each extension's manifest in parallel to surface
  // `icon` / `description` on the row. A failed read leaves the row with
  // both fields undefined (UI falls back to first-letter avatar + no
  // description). Refresh is rare and extension count is small, so the N
  // extra IPCs are acceptable. `.svg` path icons are inlined here so the
  // UI gets a ready-to-render SVG string.
  const rows = await Promise.all(
    entries.map(async (entry): Promise<ExtensionRow> => {
      const record = extensionHost.get(entry.id);
      const state: ExtensionUiState = toUiState(record?.state);
      const error = record?.error ? String(record.error) : undefined;
      let icon: string | undefined;
      let description: string | undefined;
      try {
        const manifestText = await invoke<string>('read_extension_file', {
          id: entry.id,
          path: 'manifest.json',
        });
        const manifest = JSON.parse(manifestText) as {
          icon?: string;
          description?: string;
          contributes?: Record<string, Array<{ icon?: string }>>;
        };
        icon = resolveManifestIcon(manifest);
        description = manifest.description;
        if (icon && icon.trim().toLowerCase().endsWith('.svg') && !icon.trim().startsWith('<svg')) {
          try {
            icon = await invoke<string>('read_extension_file', { id: entry.id, path: icon });
          } catch {
            icon = undefined;
          }
        }
      } catch {
        // manifest read failed — leave icon/description undefined
      }
      return { entry, state, error, icon, description };
    }),
  );
  return [...builtinRows, ...rows];
}

/** Parse a extension's manifest permissions into human-readable summary lines. */
async function readManifestPermissions(id: string): Promise<string[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const manifestText = await invoke<string>('read_extension_file', { id, path: 'manifest.json' });
  const manifest = JSON.parse(manifestText) as {
    permissions?: Record<string, unknown>;
    tier?: string;
    contributes?: Record<string, unknown>;
  };
  const out: string[] = [];
  const perms = manifest.permissions;
  if (perms) {
    if (perms.fs) out.push('文件读写（受限于插件数据目录）');
    if (perms.http) out.push('网络请求（受限于声明的 origin 白名单）');
    if (perms.clipboard) out.push('剪贴板读写');
    if (perms.dialog) out.push('文件对话框');
    if (perms.window) out.push('打开工具窗口');
    if (perms.vault) out.push('读取/插入当前文档');
  }
  const contributes = manifest.contributes;
  if (contributes) {
    if (Array.isArray(contributes.commands)) out.push(`命令 ×${contributes.commands.length}`);
    if (Array.isArray(contributes.fileTypes)) out.push(`文件类型 ×${contributes.fileTypes.length}`);
    if (Array.isArray(contributes.containers)) out.push(`容器指令 ×${contributes.containers.length}`);
    if (Array.isArray(contributes.features)) out.push(`功能面板 ×${contributes.features.length}`);
    if (Array.isArray(contributes.tools)) out.push(`工具 ×${contributes.tools.length}`);
  }
  if (manifest.tier === 'trusted') {
    out.unshift('可信层（运行于主进程，拥有完整宿主能力）');
  } else if (manifest.tier === 'sandbox') {
    out.unshift('沙箱层（独立 origin，仅经宿主 RPC 调用受控能力）');
  }
  return out;
}

function busyKey(id: string, action: string): string {
  return `${id}:${action}`;
}

export const useExtensionStore = create<ExtensionState>((set, get) => ({
  rows: [],
  refreshing: false,
  installing: false,
  busy: {},
  error: '',
  consent: null,
  renderErrors: {},

  refresh: async () => {
    if (!isTauri()) return;
    set({ refreshing: true });
    try {
      const rows = await fetchRows();
      set({ rows, refreshing: false, error: '' });
    } catch (err) {
      set({ refreshing: false, error: fmtErr(err) });
    }
  },

  installFromFolder: async (sourcePath: string) => {
    if (!isTauri()) {
      set({ error: '桌面端功能，请在 Tauri 环境中使用' });
      return;
    }
    // The install_extension command reads the id from manifest.json, so the
    // folder name is irrelevant — any folder (e.g. "dist") works.
    const id = sourcePath.replace(/\/$/, '').split('/').pop() ?? '';
    set({ installing: { id, sourcePath }, error: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_extension', { sourcePath });
      // The `extension://installed` event listener in App.tsx installs the
      // manifest into the in-memory ExtensionHost and activates sandbox
      // extensions. Refresh to pick up the new row.
      await get().refresh();
      set({ installing: false });
    } catch (err) {
      set({ installing: false, error: fmtErr(err) });
    }
  },

  installFromZip: async (filePath: string) => {
    if (!isTauri()) {
      set({ error: '桌面端功能，请在 Tauri 环境中使用' });
      return;
    }
    // Derive the extension id from the zip filename minus the `.zip` extension.
    // Must be kebab-case to match the manifest id; the Rust side cross-checks.
    const base = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    const id = base.endsWith('.zip') ? base.slice(0, -'.zip'.length) : base;
    set({ installing: { id, sourcePath: filePath }, error: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_extension_zip', { id, zipPath: filePath });
      await get().refresh();
      set({ installing: false });
    } catch (err) {
      set({ installing: false, error: fmtErr(err) });
    }
  },

  approve: async (id) => {
    if (!isTauri()) return;
    set({ busy: { ...get().busy, [busyKey(id, 'approve')]: true } });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('approve_extension', { id });
      // The `extension://approved` event listener in App.tsx activates the
      // trusted extension. Refresh to reflect the new state.
      await get().refresh();
      set({ consent: null });
    } catch (err) {
      set({ error: fmtErr(err) });
    } finally {
      const next = { ...get().busy };
      delete next[busyKey(id, 'approve')];
      set({ busy: next });
    }
  },

  activate: async (id) => {
    set({ busy: { ...get().busy, [busyKey(id, 'activate')]: true } });
    try {
      const { extensionHost } = await import("@folyn/extension-host");
      await extensionHost.activate(id);
      // Persist `enabled: true` so the extension re-activates on next launch.
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_extension_enabled', { id, enabled: true });
      }
      await get().refresh();
    } catch (err) {
      set({ error: fmtErr(err) });
      await get().refresh();
    } finally {
      const next = { ...get().busy };
      delete next[busyKey(id, 'activate')];
      set({ busy: next });
    }
  },

  deactivate: async (id) => {
    set({ busy: { ...get().busy, [busyKey(id, 'deactivate')]: true } });
    try {
      const { extensionHost } = await import("@folyn/extension-host");
      await extensionHost.deactivate(id);
      // Persist `enabled: false` so the extension stays deactivated across restarts.
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_extension_enabled', { id, enabled: false });
      }
      await get().refresh();
    } catch (err) {
      set({ error: fmtErr(err) });
      await get().refresh();
    } finally {
      const next = { ...get().busy };
      delete next[busyKey(id, 'deactivate')];
      set({ busy: next });
    }
  },

  uninstall: async (id) => {
    if (!isTauri()) return;
    set({ busy: { ...get().busy, [busyKey(id, 'uninstall')]: true } });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('uninstall_extension', { id });
      // The `extension://uninstalled` event listener in App.tsx calls
      // extensionHost.uninstall; refresh to reflect the removal.
      await get().refresh();
    } catch (err) {
      set({ error: fmtErr(err) });
    } finally {
      const next = { ...get().busy };
      delete next[busyKey(id, 'uninstall')];
      set({ busy: next });
    }
  },

  openConsent: async (id) => {
    const row = get().rows.find((r) => r.entry.id === id);
    const name = row?.entry.name ?? id;
    try {
      const permissions = await readManifestPermissions(id);
      set({ consent: { id, name, permissions } });
    } catch (err) {
      set({ error: fmtErr(err) });
    }
  },

  closeConsent: () => set({ consent: null }),
  clearError: () => set({ error: '' }),

  recordRenderError: (extensionId, e) =>
    set((s) => {
      const prev = s.renderErrors[extensionId] ?? [];
      const next = [...prev, { ...e, ts: Date.now() }].slice(-MAX_RENDER_ERRORS);
      return { renderErrors: { ...s.renderErrors, [extensionId]: next } };
    }),

  clearRenderErrors: (extensionId) =>
    set((s) => {
      if (!(extensionId in s.renderErrors)) return {};
      const next = { ...s.renderErrors };
      delete next[extensionId];
      return { renderErrors: next };
    }),

  // ── Store (catalog) ──
  catalog: EMPTY_CATALOG,
  catalogLoading: false,
  catalogError: '',

  fetchCatalog: async () => {
    if (!isTauri()) return;
    set({ catalogLoading: true, catalogError: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const resp = await invoke<{ body: string; status: number }>('fetch_url', {
        url: CATALOG_URL,
      });
      if (resp.status !== 200) {
        throw new Error(`catalog fetch status ${resp.status}`);
      }
      const parsed = JSON.parse(resp.body) as { extensions?: CatalogEntry[] };
      const entries = Array.isArray(parsed.extensions) ? parsed.extensions : [];
      set({ catalog: entries, catalogLoading: false, catalogError: '' });
    } catch (err) {
      set({ catalogLoading: false, catalogError: fmtErr(err) });
    }
  },

  installFromUrl: async (entry) => {
    if (!isTauri()) {
      set({ error: '桌面端功能，请在 Tauri 环境中使用' });
      return;
    }
    const key = busyKey(entry.id, 'store-install');
    set({ busy: { ...get().busy, [key]: true }, installing: { id: entry.id, sourcePath: entry.downloadUrl }, error: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_extension_from_url', { id: entry.id, url: entry.downloadUrl });
      // `extension://installed` listener in App.tsx installs the manifest +
      // activates sandbox extensions; refresh to reflect + flip the card.
      await get().refresh();
      set((s) => {
        const next = { ...s.busy };
        delete next[key];
        return { busy: next, installing: false };
      });
    } catch (err) {
      set((s) => {
        const next = { ...s.busy };
        delete next[key];
        return { busy: next, installing: false, error: fmtErr(err) };
      });
    }
  },

  installFromRawUrl: async (url) => {
    if (!isTauri()) {
      set({ error: '桌面端功能，请在 Tauri 环境中使用' });
      return;
    }
    // Single busy slot — only one install at a time via the URL path. The id
    // is unknown until the Rust side reads it from the downloaded manifest,
    // so derive a placeholder label from the URL's last path segment for the
    // "installing ({{id}})" affordance.
    const key = 'raw-url:install';
    const label = url.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? url;
    set({ busy: { ...get().busy, [key]: true }, installing: { id: label, sourcePath: url }, error: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // Empty `id` tells the Rust side to resolve the id from the zip's
      // manifest (see install_extension_from_url + read_manifest_id_from_zip).
      await invoke('install_extension_from_url', { id: '', url });
      await get().refresh();
      set((s) => {
        const next = { ...s.busy };
        delete next[key];
        return { busy: next, installing: false };
      });
    } catch (err) {
      set((s) => {
        const next = { ...s.busy };
        delete next[key];
        return { busy: next, installing: false, error: fmtErr(err) };
      });
    }
  },
}));
