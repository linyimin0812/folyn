import { vi } from 'vitest';

// Avoid eagerly loading @excalidraw (pulled in via file-types/registry's
// import.meta.glob({ eager: true })) during unit tests that don't render
// file-type editors. Stub the registry's public API with a real
// HandlerRegistry instance so plugin tests can exercise register/unregister
// without triggering the eager glob. HandlerRegistry itself has no side
// effects (no import.meta.glob), so it's safe to import here.
vi.mock('@/components/file-types/registry', async () => {
  const { HandlerRegistry } = await import('@/components/file-types/HandlerRegistry');
  const instance = new HandlerRegistry({ text: 'markdown' });
  return {
    registerFileTypeHandler: (h: Parameters<HandlerRegistry['register']>[0]) =>
      instance.register(h),
    unregisterFileTypeHandler: (id: string) => instance.unregister(id),
    getHandlerByExtension: (ext: string) => instance.getByExtension(ext),
    getHandlerById: (id: string) => instance.getById(id),
    getAllHandlers: () => instance.getAll(),
    /** Test-only: reset the mock registry between tests. */
    __resetTestFileRegistry: () => instance.clear(),
  };
});

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
