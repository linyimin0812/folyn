/**
 * Plugin management UI store.
 *
 * Owns the React-facing state for the Settings → Plugins tab: the list of
 * installed plugins (refreshed from `list_plugins()`), the consent-prompt
 * modal state, install-from-folder progress, and per-plugin action busy
 * flags. The source of truth for *installedness* lives on disk in
 * `plugins.json` (owned by the Rust `plugin_commands` module); this store is
 * a read-through cache + UI orchestration layer.
 *
 * State management conventions (see `.trellis/spec/desktop/frontend/state-
 * management.md`): granular selectors, `getState()` for imperative code
 * (Tauri event listeners in App.tsx), no whole-store subscriptions.
 *
 * Lifecycle event listeners (`plugin://installed` / `uninstalled` /
 * `approved`) are wired in `App.tsx`, not here — they call
 * `usePluginStore.getState().refresh()` after mutating the on-disk registry
 * so every open Settings tab sees the latest state.
 */

import { create } from 'zustand';
import { isTauri } from '@/utils/platform';

// ponytail: Tauri rejects with the serialized AppError {category, detail};
// String(obj) yields "[object Object]" and hides the cause. Pull `detail`
// when present, else fall back to String(e). Same shape as modelRegistryStore.
function fmtErr(e: unknown): string {
  return typeof e === 'object' && e && 'detail' in e
    ? String((e as { detail: unknown }).detail ?? e)
    : String(e);
}

/** Mirrors the Rust `PluginEntry` shape (plugin_commands.rs). */
export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  tier: 'sandbox' | 'trusted';
  /** TOFU trust flag — `true` after the user approves the plugin. */
  trusted: boolean;
  /** relpath → SHA-256 hex, computed at install time. */
  integrity: Record<string, string>;
  /** Optional ed25519 signature over the canonicalized manifest (PR4 scaffolding). */
  signature?: string;
  /** Optional pinned publisher public key (base64). */
  publisherPublicKey?: string;
}

/**
 * Runtime activation state, surfaced in the UI. The on-disk `PluginEntry`
 * has no `state` field (it only knows install/trust); the activation state
 * lives in the in-memory `PluginHost`. This enum is the merge of both used
 * for display.
 */
export type PluginUiState = 'installed' | 'active' | 'inactive' | 'failed';

/** Display-facing row: the on-disk entry + the host's runtime state. */
export interface PluginRow {
  entry: PluginEntry;
  state: PluginUiState;
  /** Present when `state === 'failed'`, for diagnostics. */
  error?: string;
  /** Inline-SVG / emoji / ThemeIcon-name / short-text icon (resolved from
   * the manifest; a `.svg` path has already been fetched and inlined).
   * Undefined when the manifest declares no icon or the read failed. */
  icon?: string;
  /** One-line description from the manifest. */
  description?: string;
}

/** Consent-prompt modal state. */
export interface ConsentPrompt {
  /** Plugin id being approved. */
  id: string;
  /** Plugin display name. */
  name: string;
  /** Human-readable summary of declared permissions (parsed from manifest). */
  permissions: string[];
}

interface PluginState {
  rows: PluginRow[];
  /** True while `refresh()` is in flight. */
  refreshing: boolean;
  /** True while an install-from-folder is in flight. */
  installing: false | { id: string; sourcePath: string };
  /** Per-plugin action busy flags, keyed by `${id}:${action}`. */
  busy: Record<string, boolean>;
  /** Last error surfaced to the UI (install/activate/etc.). */
  error: string;
  /** Consent-prompt modal. `null` when closed. */
  consent: ConsentPrompt | null;

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
}

/**
 * Contribution kinds that carry an icon, in display-priority order. Used to
 * derive a plugin's row icon when the manifest has no top-level `icon`.
 */
const ICON_CONTRIBUTION_KEYS = [
  'features',
  'tools',
  'containers',
  'commands',
  'fileTemplates',
] as const;

/**
 * Resolve the icon string to show for a plugin's settings row: the top-level
 * `manifest.icon` wins; otherwise fall back to the first non-empty icon
 * declared by any contribution point (features → tools → containers →
 * commands → fileTemplates). Sample plugins ship their identity icon in
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

/** Pull the host's runtime plugin records into display rows. */
async function fetchRows(): Promise<PluginRow[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const entries = await invoke<PluginEntry[]>('list_plugins');
  // Lazy-import the pluginHost so this store stays decoupled at module load.
  const { pluginHost } = await import('@quill/plugin-host');
  // Best-effort: fetch each plugin's manifest in parallel to surface
  // `icon` / `description` on the row. A failed read leaves the row with
  // both fields undefined (UI falls back to first-letter avatar + no
  // description). Refresh is rare and plugin count is small, so the N
  // extra IPCs are acceptable. `.svg` path icons are inlined here so the
  // UI gets a ready-to-render SVG string.
  const rows = await Promise.all(
    entries.map(async (entry): Promise<PluginRow> => {
      const record = pluginHost.get(entry.id);
      const state: PluginUiState = record?.state ?? 'installed';
      const error = record?.error ? String(record.error) : undefined;
      let icon: string | undefined;
      let description: string | undefined;
      try {
        const manifestText = await invoke<string>('read_plugin_file', {
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
            icon = await invoke<string>('read_plugin_file', { id: entry.id, path: icon });
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
  return rows;
}

/** Parse a plugin's manifest permissions into human-readable summary lines. */
async function readManifestPermissions(id: string): Promise<string[]> {
  if (!isTauri()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  const manifestText = await invoke<string>('read_plugin_file', { id, path: 'manifest.json' });
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

export const usePluginStore = create<PluginState>((set, get) => ({
  rows: [],
  refreshing: false,
  installing: false,
  busy: {},
  error: '',
  consent: null,

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
    // The install_plugin command reads the id from manifest.json, so the
    // folder name is irrelevant — any folder (e.g. "dist") works.
    const id = sourcePath.replace(/\/$/, '').split('/').pop() ?? '';
    set({ installing: { id, sourcePath }, error: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_plugin', { sourcePath });
      // The `plugin://installed` event listener in App.tsx installs the
      // manifest into the in-memory PluginHost and activates sandbox
      // plugins. Refresh to pick up the new row.
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
    // Derive the plugin id from the zip filename minus the `.zip` extension.
    // Must be kebab-case to match the manifest id; the Rust side cross-checks.
    const base = filePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    const id = base.endsWith('.zip') ? base.slice(0, -'.zip'.length) : base;
    set({ installing: { id, sourcePath: filePath }, error: '' });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('install_plugin_zip', { id, zipPath: filePath });
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
      await invoke('approve_plugin', { id });
      // The `plugin://approved` event listener in App.tsx activates the
      // trusted plugin. Refresh to reflect the new state.
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
      const { pluginHost } = await import('@quill/plugin-host');
      await pluginHost.activate(id);
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
      const { pluginHost } = await import('@quill/plugin-host');
      await pluginHost.deactivate(id);
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
      await invoke('uninstall_plugin', { id });
      // The `plugin://uninstalled` event listener in App.tsx calls
      // pluginHost.uninstall; refresh to reflect the removal.
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
}));
