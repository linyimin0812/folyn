import { describe, it, expect, beforeEach } from 'vitest';
import { useCspConfigStore, DEFAULT_ALLOWED_URLS } from './cspConfigStore';

beforeEach(() => {
  useCspConfigStore.setState({ mode: 'custom', allowedUrls: [...DEFAULT_ALLOWED_URLS] }, false);
});

describe('useCspConfigStore', () => {
  it('defaults to custom mode with the built-in allow-list', () => {
    expect(useCspConfigStore.getState().mode).toBe('custom');
    expect(useCspConfigStore.getState().allowedUrls).toEqual(DEFAULT_ALLOWED_URLS);
  });

  it('setMode switches the mode', () => {
    useCspConfigStore.getState().setMode('all');
    expect(useCspConfigStore.getState().mode).toBe('all');
    useCspConfigStore.getState().setMode('custom');
    expect(useCspConfigStore.getState().mode).toBe('custom');
  });

  it('addUrl trims, dedupes and ignores empty strings', () => {
    const s = useCspConfigStore.getState();
    s.addUrl('  https://extra.example.com ');
    expect(useCspConfigStore.getState().allowedUrls).toContain('https://extra.example.com');
    const count = useCspConfigStore.getState().allowedUrls.length;
    useCspConfigStore.getState().addUrl('https://extra.example.com');
    expect(useCspConfigStore.getState().allowedUrls).toHaveLength(count);
    useCspConfigStore.getState().addUrl('   ');
    expect(useCspConfigStore.getState().allowedUrls).toHaveLength(count);
  });

  it('removeUrl deletes a single entry', () => {
    useCspConfigStore.getState().removeUrl('https://cdn.jsdelivr.net');
    expect(useCspConfigStore.getState().allowedUrls).not.toContain('https://cdn.jsdelivr.net');
  });

  it('reset restores custom mode + the built-in allow-list', () => {
    useCspConfigStore.getState().setMode('all');
    useCspConfigStore.getState().removeUrl('https://esm.sh');
    useCspConfigStore.getState().reset();
    expect(useCspConfigStore.getState().mode).toBe('custom');
    expect(useCspConfigStore.getState().allowedUrls).toEqual(DEFAULT_ALLOWED_URLS);
  });

  it('hydrate applies persisted mode and URLs, ignoring garbage', () => {
    useCspConfigStore.getState().hydrate({
      mode: 'all',
      allowedUrls: ['https://a.example.com', '', 42, 'https://b.example.com'],
    });
    expect(useCspConfigStore.getState().mode).toBe('all');
    expect(useCspConfigStore.getState().allowedUrls).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('hydrate ignores invalid mode values', () => {
    useCspConfigStore.getState().hydrate({ mode: 'bogus', allowedUrls: [] });
    expect(useCspConfigStore.getState().mode).toBe('custom');
  });
});
