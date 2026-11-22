/**
 * Vault sessions: the active vault, pinned (`api.vault.session()`), plus its
 * change and file-change events. A session keeps acting on the vault it was
 * taken from, and its note-level calls reject once the user switches vaults,
 * so slow work started in one vault never lands in the next. File IO goes
 * through Rust `extension_vault_io` / `extension_data_io`, which reject
 * symlinks and write atomically.
 */
import type { Disposable, ExtensionDataStore, ExtensionManifest, ExtensionVaultFileChange, ExtensionVaultSession } from 'folyn-extension-sdk';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useVaultStore } from '@/store/vaultStore';
import { useNavStore } from '@/store/navStore';
import { resolveBasePath } from '@/utils/pathResolver';
import { openFile } from '@/services/editorIoService';
import { readEditedNoteText, appendNoteInEditor } from '@/services/editorNoteService';
import { onVaultFileChange } from './vaultFileEvents';

/** The session part of `api.vault`, plus its teardown. */
export interface VaultSessions {
  session(): ExtensionVaultSession | null;
  onSessionChange(handler: (session: ExtensionVaultSession | null) => void): Disposable;
  onFileChange(handler: (event: ExtensionVaultFileChange) => void): Disposable;
  dispose(): void;
}
function relativePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('Paths must be relative to the selected vault');
  }
  return path;
}
function notePath(path: string): string {
  const relative = relativePath(path);
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('Choose a Markdown note inside the selected vault');
  return relative;
}
export function buildVaultSessions(manifest: ExtensionManifest): VaultSessions {
  const disposers = new Set<() => void>();
  let closed = false;
  let session: ExtensionVaultSession | null = null;
  let identity = '';
  const changeHandlers = new Set<(s: ExtensionVaultSession | null) => void>();
  const fileHandlers = new Set<(e: ExtensionVaultFileChange) => void>();
  let rootPromise: Promise<string> | null = null;
  const sync = () => {
    const state = useVaultStore.getState();
    const vault = state.isLoading ? null : state.currentVault;
    const next = vault && (vault.providerType === 'tauri' || vault.providerType === 'github') ? `${vault.id}:${vault.basePath}` : '';
    if (next === identity) return;
    identity = next;
    if (!vault || !next) { session = null; rootPromise = null; }
    else {
      const capturedId = vault.id;
      const capturedRoot = resolveBasePath(vault.basePath).then(v => v.replace(/[\\/]+$/, ''));
      rootPromise = capturedRoot;
      const assertCurrent = () => {
        if (closed || session !== snapshot || useVaultStore.getState().isLoading || useVaultStore.getState().activeVaultId !== capturedId || useVaultStore.getState().currentVault?.id !== capturedId || identity !== next) throw new Error('The selected vault has changed');
      };
      const io = async <T>(operation: string, path: string, content?: string): Promise<T> => {
        if (closed) throw new Error('Extension is inactive');
        relativePath(path);
        return invoke<T>('extension_vault_io', { extensionId: manifest.id, root: await capturedRoot, path, operation, content: content ?? null });
      };
      const dataIo = async <T>(operation: string, path: string, content?: string): Promise<T> => {
        if (closed) throw new Error('Extension is inactive');
        relativePath(path);
        return invoke<T>('extension_data_io', { extensionId: manifest.id, vaultId: capturedId, path, operation, content: content ?? null });
      };
      const data: ExtensionDataStore = {
        readText: path => dataIo<string>('readText', path),
        async readBinary(path) { return Uint8Array.from(atob(await dataIo<string>('readBinary', path)), c => c.charCodeAt(0)); },
        async writeText(path, content) { await dataIo('writeText', path, content); },
        async writeBinary(path, content) {
          let value = ''; for (const byte of content) value += String.fromCharCode(byte);
          await dataIo('writeBinary', path, btoa(value));
        },
        exists: path => dataIo<boolean>('exists', path),
        async remove(path) { await dataIo('remove', path); },
        async assetUrl(path) { return convertFileSrc(await dataIo<string>('assetPath', path)); },
      };
      const snapshot: ExtensionVaultSession = {
        id: capturedId, name: vault.name, data,
        readText: path => io<string>('readText', path),
        async readBinary(path) { return Uint8Array.from(atob(await io<string>('readBinary', path)), c => c.charCodeAt(0)); },
        async writeText(path, content) { await io('writeText',path,content); },
        async writeBinary(path, content) {
          let value = ''; for (const byte of content) value += String.fromCharCode(byte);
          await io('writeBinary',path,btoa(value));
        },
        async createText(path, content) {
          await io('createText',path,content);
          if (useVaultStore.getState().currentVault?.id === capturedId) void useVaultStore.getState().refreshFileTree();
        },
        exists: path => io<boolean>('exists',path),
        async remove(path) { await io('remove',path); },
        async assetUrl(path) { return convertFileSrc(`${await capturedRoot}/${relativePath(path)}`); },
        async open(path) {
          assertCurrent();
          const content = await snapshot.readText(path);
          assertCurrent();
          await openFile(relativePath(path), path.split('/').pop() || path, { expectedVaultId: capturedId, readText: async () => content });
          assertCurrent();
          useNavStore.getState().setCurrentPage('editor');
        },
        async readNote(path) {
          assertCurrent();
          const relative = notePath(path);
          // Native IO validates grant, scoped path and symlinks even for dirty tabs.
          const diskText = await snapshot.readText(relative);
          assertCurrent();
          const filename = relative.split('/').pop() || relative;
          return {
            path: relative,
            title: filename.replace(/\.md$/i, '') || filename,
            text: readEditedNoteText(capturedId, relative) ?? diskText,
          };
        },
        async chooseNotes() {
          assertCurrent();
          const { open } = await import('@tauri-apps/plugin-dialog');
          const root = (await capturedRoot).replace(/\\/g, '/');
          assertCurrent();
          const picked = await open({ directory: false, multiple: true, defaultPath: root, filters: [{ name: 'Markdown', extensions: ['md'] }] });
          assertCurrent();
          if (!picked) return [];
          const paths = (Array.isArray(picked) ? picked : [picked]).map(path => {
            const normalized = path.replace(/\\/g, '/');
            if (!normalized.startsWith(`${root}/`)) throw new Error('Choose a Markdown note inside the selected vault');
            return notePath(normalized.slice(root.length + 1));
          });
          const notes = [];
          for (const path of new Set(paths)) notes.push(await snapshot.readNote(path));
          assertCurrent();
          return notes;
        },
        async appendNote(path, text, expectedText) {
          assertCurrent();
          const relative = notePath(path);
          await appendNoteInEditor({
            vaultId: capturedId, path: relative, text, expectedText, assertCurrent,
            readText: async () => (await snapshot.readNote(relative)).text,
          });
        },
        async chooseDirectory() {
          assertCurrent();
          const { open } = await import('@tauri-apps/plugin-dialog');
          const root = await capturedRoot;
          const picked = await open({ directory: true, multiple: false, defaultPath: root });
          assertCurrent();
          if (!picked || Array.isArray(picked)) return null;
          const normalized = picked.replace(/\\/g, '/').replace(/\/+$/, '');
          const base = root.replace(/\\/g, '/');
          if (normalized === base) return '.';
          if (!normalized.startsWith(`${base}/`)) throw new Error('Choose a directory inside the selected vault');
          return relativePath(normalized.slice(base.length + 1));
        },
      };
      session = snapshot;
    }
    for (const cb of changeHandlers) { try { cb(session); } catch (e) { console.error('[vault-session] listener failed',e); } }
  };
  sync();
  disposers.add(useVaultStore.subscribe(sync));
  const publish = (event: ExtensionVaultFileChange) => {
    if (closed) return;
    for (const cb of fileHandlers) { try { cb(event); } catch (e) { console.error('[vault-session] file listener failed',e); } }
  };
  disposers.add(onVaultFileChange(publish));
  void listen<{ type: string; root: string; paths: string[] }>('app://vault-watcher-event', async ({ payload }) => {
    const captured = session;
    const pendingRoot = rootPromise;
    if (!captured || !pendingRoot) return;
    const root = (await pendingRoot).replace(/\\/g, '/');
    if (closed || session !== captured || payload.root?.replace(/\\/g, '/').replace(/\/+$/, '') !== root) return;
    const paths = payload.paths.map(p => p.replace(/\\/g, '/')).filter(p => p.startsWith(`${root}/`)).map(p => p.slice(root.length + 1));
    if (payload.type.includes('Name(Both)') && paths.length >= 2) publish({ vaultId: captured.id, path: paths[0], newPath: paths[1] });
    else if (payload.type.includes('Remove')) for (const path of paths) publish({ vaultId: captured.id, path, deleted: true });
  }).then(stop => { if (closed) stop(); else disposers.add(stop); }).catch(e => console.error('[vault-session] watcher unavailable',e));
  return {
    session: () => session,
    onSessionChange(handler) { changeHandlers.add(handler); return { dispose: () => { changeHandlers.delete(handler); } }; },
    onFileChange(handler) { fileHandlers.add(handler); return { dispose: () => { fileHandlers.delete(handler); } }; },
    dispose() {
      closed = true;
      for (const dispose of disposers) dispose();
      changeHandlers.clear(); fileHandlers.clear();
    },
  };
}
