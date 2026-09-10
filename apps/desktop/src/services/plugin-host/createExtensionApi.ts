/**
 * createExtensionApi — builds a real {@link ExtensionApi} for a trusted-tier
 * extension (Phase 2, doc §63). Wires the existing host capability impls
 * (ai / network / env) + the P1 registries (export service, file-type,
 * exporter) into the capability boundary the loader hands to
 * `module.activate(api, ctx)`.
 *
 * Slots without a real impl yet (vault/files/editor/terminal/storage/events)
 * are operational no-ops so the api is never `undefined` — a plugin that
 * touches them gets a defined throw/empty, not a crash on `undefined`.
 */

import type {
  CommandContributionApi,
  ExportService,
  ExtensionApi,
  ExtensionManifest,
  FileApi,
  EditorApi,
  TerminalApi,
  EventApi,
  ExtensionStorageApi,
  FileTypeRegistryApi,
  ExporterRegistryApi,
  VaultApi,
  WorkspaceContextApi,
} from 'folyn-plugin-sdk';
import type { ExtensionApiHandle } from '@folyn/plugin-host';
import { exportService, exporterRegistry } from '../export/exporterRegistry';
import { registerFileTypeHandler, resolveDefault } from '@/components/file-types/registry';
import { buildPluginAi } from './aiCapability';
import { buildPluginEnv, disposePluginEnv } from './envCapability';
import { buildPluginHttp } from './httpCapability';
import type { PluginAiCapability, PluginEnv, PluginHttpCapability } from 'folyn-plugin-sdk';
import type { Disposable as Disp } from 'folyn-plugin-sdk';
import { useVaultStore } from '@/store/vaultStore';
import { storageClient } from '@/utils/storageClient';
import { openFile } from '@/services/editorIoService';
import { getActiveEditorHandle } from '@/services/editorHandleRegistry';
import { useTerminalStore } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { disposable } from '@folyn/plugin-host';

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
 * traversal (`..`) so an extension can't escape the vault (doc §29 — plugins
 * never get other vaults' physical paths). */
async function resolveVaultPath(relPath: string): Promise<string> {
  if (/(^|\/|\\)\.\.(\/|\\|$)/.test(relPath)) {
    throw new Error(`[extension-api] vault path escapes the vault: ${relPath}`);
  }
  const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
  if (!vaultRoot) throw new Error('[extension-api] no active vault');
  const { join } = await import('@tauri-apps/api/path');
  return join(vaultRoot, relPath);
}

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
  };
}

/** Build a real ExtensionStorageApi namespaced per extension id (so plugins
 * can't collide on keys). Backed by the shared storageClient (per-vault JSON). */
function createStorageApi(manifest: ExtensionManifest): ExtensionStorageApi {
  const ns = `ext:${manifest.id}:`;
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
 * so plugins can't bypass the host's tab/permission chokepoint). */
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
 * global editor handle registry). Plugins get high-level selection ops,
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

const noopWorkspace: WorkspaceContextApi = {};

const noopCommands = {
  register: (_c: CommandContributionApi): Disp => ({ dispose() {} }),
};


/**
 * Build the ExtensionApi for a manifest. The returned handle's `dispose()`
 * releases the env capability's host-side subscriptions; the loader pushes it
 * as a disposable so ExtensionHost reaps it on deactivate.
 */
export function createExtensionApi(manifest: ExtensionManifest): ExtensionApiHandle {
  const ai: PluginAiCapability = buildPluginAi(manifest);
  const network: PluginHttpCapability = buildPluginHttp(manifest);
  const env: PluginEnv = buildPluginEnv();

  const fileTypes: FileTypeRegistryApi = {
    register: (provider, ownerExtensionId) =>
      registerFileTypeHandler(provider as never, ownerExtensionId),
    resolve: (path: string) => {
      const ext = path.split('.').pop()?.toLowerCase() ?? '';
      return resolveDefault(ext);
    },
  };

  const exporters: ExporterRegistryApi = {
    register: (registration, ownerExtensionId) =>
      exporterRegistry.register(registration as never, ownerExtensionId),
    list: (fileType?: string) =>
      fileType ? exporterRegistry.getForFileType(fileType, { filePath: '', vaultRoot: '', content: '' }) : exporterRegistry.list(),
  };

  const vault = createVaultApi();
  const storage = createStorageApi(manifest);
  const api: ExtensionApi = {
    vault,
    files: createFilesApi(),
    editor: createEditorApi(),
    workspace: noopWorkspace,
    commands: noopCommands,
    events: createEventsApi(),
    storage,
    ai,
    network,
    env,
    terminal: createTerminalApi(),
    export: exportService as ExportService,
    fileTypes,
    exporters,
  };

  return {
    api,
    dispose: { dispose: () => disposePluginEnv(env) },
  };
}
