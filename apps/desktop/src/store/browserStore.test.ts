import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBrowserStore } from './browserStore';
import { invoke } from '@tauri-apps/api/core';
import { webviewCache } from '@/components/file-types/web/WebViewer';

beforeEach(() => {
  useBrowserStore.setState({
    passwords: [],
    passwordImporting: false,
    cookieImporting: false,
    notice: null,
  });
  invoke.mockClear();
  webviewCache.clear();
});

describe('useBrowserStore', () => {
  it('importPasswords decrypts, merges, persists and reports a count', async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'import_chrome_passwords') {
        return [[{ id: 'a:u', url: 'https://a.com', username: 'u', password: 'p' }], { imported: 1, skipped: 0 }];
      }
      return undefined;
    });
    const count = await useBrowserStore.getState().importPasswords();
    expect(count).toBe(1);
    expect(useBrowserStore.getState().passwords).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('save_imported_passwords', {
      passwords: [{ id: 'a:u', url: 'https://a.com', username: 'u', password: 'p' }],
    });
  });

  it('importCookies applies the imported cookies to every cached webview', async () => {
    webviewCache.set('web:https://a.com', { label: 'wv-1', url: 'https://a.com' });
    webviewCache.set('web:https://b.com', { label: 'wv-2', url: 'https://b.com' });
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'import_chrome_cookies') return { imported: 5, skipped: 1 };
      if (cmd === 'apply_imported_cookies') return 5;
      return undefined;
    });
    const count = await useBrowserStore.getState().importCookies();
    expect(count).toBe(5);
    const applyCalls = invoke.mock.calls.filter(([cmd]) => cmd === 'apply_imported_cookies');
    expect(applyCalls.map(([, args]) => (args as { label: string }).label).sort()).toEqual(['wv-1', 'wv-2']);
    expect(useBrowserStore.getState().notice).toContain('5');
  });

  it('removePassword deletes an entry and persists the remainder', async () => {
    useBrowserStore.setState({
      passwords: [
        { id: 'a', url: 'https://a.com', username: 'u', password: 'p' },
        { id: 'b', url: 'https://b.com', username: 'v', password: 'q' },
      ],
    });
    useBrowserStore.getState().removePassword('a');
    expect(useBrowserStore.getState().passwords.map((p) => p.id)).toEqual(['b']);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('save_imported_passwords', {
        passwords: [{ id: 'b', url: 'https://b.com', username: 'v', password: 'q' }],
      }),
    );
  });
});
