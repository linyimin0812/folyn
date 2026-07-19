import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the raw tauri invoke — the wrapper under test calls it.
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

import { invoke, AppInvocationError } from './tauriInvoke';
import i18n from '@/i18n';

beforeEach(() => {
  invokeMock.mockReset();
  void i18n.changeLanguage('zh');
});

describe('tauriInvoke', () => {
  it('returns the resolved value on success', async () => {
    invokeMock.mockResolvedValueOnce(42);
    await expect(invoke('add', { a: 1, b: 2 })).resolves.toBe(42);
    expect(invokeMock).toHaveBeenCalledWith('add', { a: 1, b: 2 });
  });

  it('converts a {category, detail} rejection into AppInvocationError', async () => {
    invokeMock.mockRejectedValueOnce({ category: 'notFound', detail: 'foo.md' });
    await expect(invoke('open_file', { path: 'foo.md' })).rejects.toMatchObject({
      name: 'AppInvocationError',
      category: 'notFound',
      detail: 'foo.md',
    });
  });

  it('translatedMessage() interpolates detail for the current locale', async () => {
    invokeMock.mockRejectedValueOnce({ category: 'notFound', detail: 'foo.md' });
    try {
      await invoke('open_file', { path: 'foo.md' });
    } catch (err) {
      expect(err).toBeInstanceOf(AppInvocationError);
      const e = err as AppInvocationError;
      expect(e.category).toBe('notFound');
      expect(e.translatedMessage()).toBe('未找到目标：foo.md');
      return;
    }
    throw new Error('expected invoke to reject');
  });

  it('translatedTitle() maps to rustErrors:<category>.title', async () => {
    invokeMock.mockRejectedValueOnce({ category: 'permission', detail: '/x' });
    try {
      await invoke('read_file', { path: '/x' });
    } catch (err) {
      const e = err as AppInvocationError;
      expect(e.translatedTitle()).toBe('权限不足');
      return;
    }
    throw new Error('expected invoke to reject');
  });

  it('a plain string rejection collapses to category=internal', async () => {
    invokeMock.mockRejectedValueOnce('boom');
    await expect(invoke('something')).rejects.toMatchObject({
      name: 'AppInvocationError',
      category: 'internal',
      detail: 'boom',
    });
  });

  it('respects locale switch (en)', async () => {
    await i18n.changeLanguage('en');
    invokeMock.mockRejectedValueOnce({ category: 'notFound', detail: 'bar.md' });
    try {
      await invoke('open_file', { path: 'bar.md' });
    } catch (err) {
      const e = err as AppInvocationError;
      expect(e.translatedMessage()).toBe('Not found: bar.md');
      return;
    }
    throw new Error('expected invoke to reject');
  });
});
