import { vi } from 'vitest';

// Avoid eagerly loading @excalidraw (pulled in via file-types/registry's
// import.meta.glob({ eager: true })) during unit tests that don't render
// file-type editors. Stub the registry's public API.
vi.mock('@/components/file-types/registry', () => ({
  getHandlerByExtension: () => undefined,
  getHandlerById: () => undefined,
  getAllHandlers: () => [],
}));

// jsdom doesn't ship window.matchMedia; polyfill it so settingsStore
// can resolve 'system' theme.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
