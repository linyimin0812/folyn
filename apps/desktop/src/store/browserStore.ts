import { create } from 'zustand';
import { isTauri } from '@/utils/platform';

export interface ImportedPassword {
  id: string;
  url: string;
  username: string;
  password: string;
}

export interface ImportOutcome {
  imported: number;
  skipped: number;
  error?: string | null;
}

interface BrowserState {
  passwords: ImportedPassword[];
  passwordImporting: boolean;
  cookieImporting: boolean;
  notice: string | null;
  /** Restore previously imported passwords from disk. */
  loadPasswords: () => Promise<void>;
  /** Import Chrome cookies into every open webview; returns count. */
  importCookies: () => Promise<number | null>;
  /** Decrypt + persist Chrome passwords; returns count. */
  importPasswords: () => Promise<number | null>;
  removePassword: (id: string) => void;
  clearPasswords: () => Promise<void>;
  setNotice: (msg: string | null) => void;
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  passwords: [],
  passwordImporting: false,
  cookieImporting: false,
  notice: null,

  loadPasswords: async () => {
    if (!isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const passwords = await invoke<ImportedPassword[]>('load_imported_passwords');
      set({ passwords });
    } catch {
      // Non-fatal — no saved passwords yet.
    }
  },

  importCookies: async () => {
    if (!isTauri()) return null;
    set({ cookieImporting: true });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<ImportOutcome>('import_chrome_cookies');
      // Push the imported cookies into every live webview (browser tabs keep
      // their labels in the module-level webviewCache).
      const { webviewCache } = await import('@/components/file-types/web/WebViewer');
      let applied = 0;
      for (const label of new Set(Array.from(webviewCache.values()).map((v) => v.label))) {
        try {
          applied += await invoke<number>('apply_imported_cookies', { label });
        } catch {
          // webview may have been closed mid-import
        }
      }
      set({
        notice: result.error
          ? `${result.imported} 个 Cookie 已导入（部分失败：${result.error}）`
          : `${result.imported} 个 Cookie 已导入，应用到 ${applied} 个页面`,
      });
      return result.imported;
    } catch (err) {
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
      set({ notice: `Cookie 导入失败：${msg}` });
      return null;
    } finally {
      set({ cookieImporting: false });
    }
  },

  importPasswords: async () => {
    if (!isTauri()) return null;
    set({ passwordImporting: true });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const [passwords, result] = await invoke<[ImportedPassword[], ImportOutcome]>(
        'import_chrome_passwords',
      );
      const merged = new Map<string, ImportedPassword>();
      for (const p of [...get().passwords, ...passwords]) merged.set(p.id, p);
      const all = Array.from(merged.values());
      set({ passwords: all, notice: result.error ? `密码导入完成：${result.error}` : `已导入 ${passwords.length} 个密码` });
      await invoke('save_imported_passwords', { passwords: all });
      return passwords.length;
    } catch (err) {
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
      set({ notice: `密码导入失败：${msg}` });
      return null;
    } finally {
      set({ passwordImporting: false });
    }
  },

  removePassword: (id) => {
    const next = get().passwords.filter((p) => p.id !== id);
    set({ passwords: next });
    if (isTauri()) {
      void import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('save_imported_passwords', { passwords: next }).catch(() => {});
      });
    }
  },

  clearPasswords: async () => {
    set({ passwords: [] });
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('clear_imported_passwords');
      } catch {
        // ignore
      }
    }
  },

  setNotice: (notice) => set({ notice }),
}));
