/**
 * createExtensionApi — builds a real {@link ExtensionApi} for a trusted-tier
 * extension by folding over registered {@link CapabilityProvider}s (the
 * platform-service seam). Each capability (vault / editor / ai / network / env
 * / terminal / storage / events / fileTypes / exporters / ...) is a factory
 * that self-registers at module load; `buildExtensionApi` assembles them and
 * collects each provider's `dispose` (env subscriptions today) into one
 * `Disposable` the host reaps on deactivate.
 *
 * The `createApi` hook in App.tsx calls this; the hook stays as the whole-Api
 * override escape hatch for tests / alternate shells (ADR-lite, Option A).
 *
 * Slots without a real impl yet (workspace/commands) are registered as
 * operational no-ops so the api is never `undefined` — an extension that
 * touches them gets a defined throw/empty, not a crash on `undefined`.
 */

import type {
  CommandContributionApi,
  ExportService,
  ExtensionManifest,
  FileApi,
  EditorApi,
  TerminalApi,
  EventApi,
  ExtensionStorageApi,
  FileTypeRegistryApi,
  ExporterRegistryApi,
  VaultApi,
  VaultConfigApi,
  WorkspaceContextApi,
} from 'folyn-extension-sdk';
import type { ExtensionApiHandle } from '@folyn/extension-host';
import { registerCapability, buildExtensionApi, disposable } from '@folyn/extension-host';
import { exportService, exporterRegistry } from '../export/exporterRegistry';
import { registerFileTypeHandler, resolveDefault } from '@/components/file-types/registry';
import { buildExtensionAi } from './aiCapability';
import { buildExtensionEnv, disposeExtensionEnv } from './envCapability';
import { buildExtensionHttp } from './httpCapability';
import type { Disposable as Disp } from 'folyn-extension-sdk';
import { useVaultStore } from '@/store/vaultStore';
import { useVaultConfigStore } from '@/store/vaultConfigStore';
import { storageClient } from '@/utils/storageClient';
import { openFile } from '@/services/editorIoService';
import { getActiveEditorHandle } from '@/services/editorHandleRegistry';
import { useTerminalStore } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { isTauri } from '@/utils/platform';
import { resolveBasePath } from '@/utils/pathResolver';

/** A simple per-extension in-memory event bus. */
function createEventsApi(): EventApi {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(handler);
      return disposable(() => { set!.delete(handler); });
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (set) for (const h of set) { try { h(payload); } catch (e) { console.error('[extension-api] event handler threw:', e); } }
    },
  };
}

/** Resolve a vault-relative path against the active vault root, rejecting
 * traversal (`..`) so an extension can't escape the vault (doc §29 — extensions
 * never get other vaults' physical paths). */
async function resolveVaultPath(relPath: string): Promise<string> {
  if (/(^|\/|\\)\.\.(\/|\\|$)/.test(relPath)) {
    throw new Error(`[extension-api] vault path escapes the vault: ${relPath}`);
  }
  const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
  if (!vaultRoot) throw new Error('[extension-api] no active vault');
  // Route through resolvePreviewPath so the vault root's `~` is expanded to the
  // real home dir before the OS sees it (a raw join leaves a literal `~` →
  // "No such file or directory").
  const { resolvePreviewPath } = await import('@/components/file-types/previewPath');
  return resolvePreviewPath(relPath, vaultRoot);
}

let _convertFileSrc: ((p: string) => string) | null = null;
// ponytail: pre-warm convertFileSrc on module load (Tauri core is sync once
// imported, but ESM dynamic import is async). If toAssetUrl is called before
// the import resolves (very early startup), it falls back to returning the
// raw path — no crash, just no asset:// translation. Upgrade: block init
// on the import if a caller ever needs guaranteed sync behavior.
void import('@tauri-apps/api/core')
  .then(({ convertFileSrc }) => { _convertFileSrc = convertFileSrc; })
  .catch(() => {});

/** Build a real VaultApi for a manifest (Tauri-backed, vault-scoped). */
function createVaultApi(): VaultApi {
  return {
    async readText(path) {
      const abs = await resolveVaultPath(path);
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      return readTextFile(abs);
    },
    async readBinary(path) {
      const abs = await resolveVaultPath(path);
      const { readFile } = await import('@tauri-apps/plugin-fs');
      return new Uint8Array(await readFile(abs));
    },
    async writeText(path, content) {
      const abs = await resolveVaultPath(path);
      const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const { dirname } = await import('@tauri-apps/api/path');
      const dir = await dirname(abs);
      if (dir) await mkdir(dir, { recursive: true }).catch(() => {});
      await writeTextFile(abs, content);
    },
    async writeBinary(path, data) {
      const abs = await resolveVaultPath(path);
      const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const { dirname } = await import('@tauri-apps/api/path');
      const dir = await dirname(abs);
      if (dir) await mkdir(dir, { recursive: true }).catch(() => {});
      await writeFile(abs, data);
    },
    toAssetUrl(fsPath) {
      if (!isTauri() || !_convertFileSrc) return fsPath;
      return _convertFileSrc(fsPath);
    },
    async resolvePath(path) {
      if (!isTauri()) return path;
      return resolveBasePath(path);
    },
  };
}

/** Build a real VaultConfigApi over the host's vault-config store. */
function createVaultConfigApi(): VaultConfigApi {
  return {
    getImagePath() {
      return useVaultConfigStore.getState().imagePath?.replace(/\/+$/, '') || 'assets/images/';
    },
  };
}

import { extensionStoragePrefix } from './extensionStoragePrefix';

/** Build a real ExtensionStorageApi namespaced per extension id (so extensions
 * can't collide on keys). Backed by the shared storageClient (global JSON cache
 * with a debounced disk flush). */
function createStorageApi(manifest: ExtensionManifest): ExtensionStorageApi {
  const ns = extensionStoragePrefix(manifest.id);
  return {
    async get(key) {
      return storageClient.get(`${ns}${key}`);
    },
    async set(key, value) {
      await storageClient.set(`${ns}${key}`, value);
    },
  };
}

/** Build a real FileApi (open routes through the shared editorIoService.openFile
 * so extensions can't bypass the host's tab/permission chokepoint). */
function createFilesApi(): FileApi {
  return {
    async open(path) {
      const name = path.split('/').pop() || path;
      await openFile(path, name);
    },
  };
}

/** Build a real TerminalApi backed by the terminal + editor-view-state stores
 * (open/close the dock, create sessions). */
function createTerminalApi(): TerminalApi {
  return {
    open() {
      const term = useTerminalStore.getState();
      if (term.sessions.length === 0) term.addSession();
      useEditorViewStateStore.getState().openTerminalDock();
    },
    close() {
      useEditorViewStateStore.getState().closeTerminalPanel();
    },
    createSession() {
      const id = useTerminalStore.getState().addSession();
      useEditorViewStateStore.getState().openTerminalDock();
      return id;
    },
  };
}

/** Build a real EditorApi backed by the active CodeMirror view (via the
 * global editor handle registry). Extensions get high-level selection ops,
 * never the internal view (doc §15). */
function createEditorApi(): EditorApi {
  return {
    getSelection() {
      const view = getActiveEditorHandle()?.getView();
      if (!view) return null;
      const sel = view.state.selection.main;
      const text = view.state.sliceDoc(sel.from, sel.to);
      return {
        text,
        startLine: view.state.doc.lineAt(sel.from).number,
        startCol: sel.from - view.state.doc.lineAt(sel.from).from,
        endLine: view.state.doc.lineAt(sel.to).number,
        endCol: sel.to - view.state.doc.lineAt(sel.to).from,
      };
    },
    async replaceSelection(text) {
      const view = getActiveEditorHandle()?.getView();
      if (!view) return;
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
    },
  };
}

/** Build a real FileTypeRegistryApi backed by the host file-type registry. */
function createFileTypesApi(): FileTypeRegistryApi {
  return {
    register: (provider, ownerExtensionId) =>
      registerFileTypeHandler(provider as never, ownerExtensionId),
    resolve: (path: string) => {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      return resolveDefault(ext);
    },
  };
}

/** Build a real ExporterRegistryApi backed by the host exporter registry. */
function createExportersApi(): ExporterRegistryApi {
  return {
    register: (registration, ownerExtensionId) =>
      exporterRegistry.register(registration as never, ownerExtensionId),
    list: (fileType?: string) =>
      fileType ? exporterRegistry.getForFileType(fileType, { filePath: '', vaultRoot: '', content: '' }) : exporterRegistry.list(),
  };
}

const noopWorkspace: WorkspaceContextApi = {};

const noopCommands = {
  register: (_c: CommandContributionApi): Disp => ({ dispose() {} }),
};

// ── Capability provider self-registration (platform-service seam) ────────────
// Each capability registers a provider for one ExtensionApi slot; buildExtensionApi
// folds them into the ExtensionApi handed to module.activate(api, ctx). Adding a
// capability = add a factory + one registerCapability line. The createApi hook
// (App.tsx) calls createExtensionApi → buildExtensionApi; the hook remains the
// whole-Api override escape hatch for tests / alternate shells.
registerCapability({ slot: 'vault', build: () => createVaultApi() });
registerCapability({ slot: 'vaultConfig', build: () => createVaultConfigApi() });
registerCapability({ slot: 'storage', build: (m) => createStorageApi(m) });
registerCapability({ slot: 'files', build: () => createFilesApi() });
registerCapability({ slot: 'editor', build: () => createEditorApi() });
registerCapability({ slot: 'terminal', build: () => createTerminalApi() });
registerCapability({ slot: 'events', build: () => createEventsApi() });
registerCapability({ slot: 'ai', build: (m) => buildExtensionAi(m) });
registerCapability({ slot: 'network', build: (m) => buildExtensionHttp(m) });
registerCapability({
  slot: 'env',
  build: () => buildExtensionEnv(),
  dispose: (env) => disposeExtensionEnv(env),
});
registerCapability({ slot: 'workspace', build: () => noopWorkspace });
registerCapability({ slot: 'commands', build: () => noopCommands });
registerCapability({ slot: 'fileTypes', build: () => createFileTypesApi() });
registerCapability({ slot: 'exporters', build: () => createExportersApi() });
registerCapability({ slot: 'export', build: () => exportService as ExportService });

/**
 * Build the ExtensionApi for a manifest by folding over registered capability
 * providers. The returned handle's `dispose()` releases provider teardowns
 * (env subscriptions today); the loader pushes it as a disposable so
 * ExtensionHost reaps it on deactivate.
 */
export function createExtensionApi(manifest: ExtensionManifest): ExtensionApiHandle {
  return buildExtensionApi(manifest);
}
