import type { ExtensionManifest, ExtensionSubscriptions, ExtensionVaultSession, ExtensionSubscriptionData, ExtensionVaultFileChange, ExtensionHttpResponse } from 'folyn-extension-sdk';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useVaultStore } from '@/store/vaultStore';
import { useNavStore } from '@/store/navStore';
import { useExtensionPageStore } from '@/store/extensionPageStore';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { resolveBasePath } from '@/utils/pathResolver';
import { openFile } from '@/services/editorIoService';
import { readEditedNoteText, appendNoteInEditor } from '@/services/editorNoteService';
import { onVaultFileChange } from './subscriptionsFileEvents';

const teardowns = new WeakMap<ExtensionSubscriptions, () => void>();
function relativePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('Subscription paths must be relative to the selected vault');
  }
  return path;
}
function notePath(path: string): string {
  const relative = relativePath(path);
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('Choose a Markdown note inside the selected vault');
  return relative;
}
export function buildSubscriptions(manifest: ExtensionManifest): ExtensionSubscriptions | undefined {
  if (manifest.tier !== 'trusted' || manifest.permissions?.subscriptions?.vault !== true || manifest.permissions.subscriptions.network !== true) return undefined;
  const disposers = new Set<() => void>();
  let closed = false;
  let session: ExtensionVaultSession | null = null;
  let identity = '';
  let badge = 0;
  const renderRequests = new Set<string>();
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
        if (closed) throw new Error('Subscriptions extension is inactive');
        relativePath(path);
        return invoke<T>('subscription_vault_io', { extensionId: manifest.id, root: await capturedRoot, path, operation, content: content ?? null });
      };
      const dataIo = async <T>(operation: string, path: string, content?: string): Promise<T> => {
        if (closed) throw new Error('Subscriptions extension is inactive');
        relativePath(path);
        return invoke<T>('subscription_data_io', { extensionId: manifest.id, vaultId: capturedId, path, operation, content: content ?? null });
      };
      const data: ExtensionSubscriptionData = {
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
    for (const cb of changeHandlers) { try { cb(session); } catch (e) { console.error('[subscriptions] vault listener failed',e); } }
  };
  sync();
  disposers.add(useVaultStore.subscribe(sync));
  const publish = (event: ExtensionVaultFileChange) => {
    if (closed) return;
    for (const cb of fileHandlers) { try { cb(event); } catch (e) { console.error('[subscriptions] file listener failed',e); } }
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
  }).then(stop => { if (closed) stop(); else disposers.add(stop); }).catch(e => console.error('[subscriptions] watcher unavailable',e));
  const applyBadge = () => {
    for (const page of manifest.contributes?.pages ?? []) useExtensionPageStore.getState().setBadge(`ext:${manifest.id}.${page.id}`, badge);
    for (const feature of manifest.contributes?.features ?? []) useFeaturePanelStore.getState().setBadge(feature.id, badge);
  };
  // Activation can set the badge before contribution adapters register pages.
  disposers.add(useExtensionPageStore.subscribe((state, prev) => { if (state.pages.length !== prev.pages.length) applyBadge(); }));
  const api: ExtensionSubscriptions = {
    ...(manifest.permissions.subscriptions.render === true ? {
      async render(url: string): Promise<ExtensionHttpResponse & { url: string }> {
        if (closed) throw new Error('Subscriptions extension is inactive');
        const requestId = crypto.randomUUID();
        renderRequests.add(requestId);
        try {
          const result = await invoke<ExtensionHttpResponse & { url: string }>('subscription_render', { extensionId: manifest.id, requestId, url });
          if (closed) throw new Error('Subscriptions extension is inactive');
          return result;
        } finally { renderRequests.delete(requestId); }
      },
    } : {}),
    current: () => session,
    onChange(handler) { changeHandlers.add(handler); return { dispose: () => { changeHandlers.delete(handler); } }; },
    onFileChange(handler) { fileHandlers.add(handler); return { dispose: () => { fileHandlers.delete(handler); } }; },
    async openExternal(url) {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only HTTP(S) URLs are supported');
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(parsed.href);
    },
    openSettings() { const nav = useNavStore.getState(); nav.setSettingsTab('models'); nav.setCurrentPage('settings'); },
    openVaults() { useNavStore.getState().setCurrentPage('vault'); },
    setBadge(value) { badge = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; applyBadge(); },
    async fetch(url,binary = false) {
      if (closed) throw new Error('Subscriptions extension is inactive');
      const requestId = binary && manifest.permissions?.subscriptions?.render === true ? crypto.randomUUID() : null;
      if (requestId) renderRequests.add(requestId);
      try {
        const result = await invoke<ExtensionHttpResponse & { url: string }>('subscription_fetch', { extensionId: manifest.id, url, binary, requestId });
        if (closed) throw new Error('Subscriptions extension is inactive');
        return result;
      } finally { if (requestId) renderRequests.delete(requestId); }
    },
  };
  teardowns.set(api, () => {
    closed = true;
    const pending = [...renderRequests];
    for (let offset = 0; offset < pending.length; offset += 32) {
      void invoke('subscription_cancel_renders', { extensionId: manifest.id, requestIds: pending.slice(offset, offset + 32) }).catch(() => {});
    }
    renderRequests.clear();
    for (const dispose of disposers) dispose();
    changeHandlers.clear(); fileHandlers.clear(); badge = 0; applyBadge();
  });
  return api;
}
export function disposeSubscriptions(api: ExtensionSubscriptions | undefined): void { if (api) teardowns.get(api)?.(); }
