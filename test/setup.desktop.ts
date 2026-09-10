import { vi } from 'vitest';
import '@/i18n';
import i18n from '@/i18n';

// Default the test locale to zh so legacy Chinese-string assertions
// (e.g. ActivityBar.test.tsx > getByTitle('设置')) keep passing. Per-test
// overrides can still call i18n.changeLanguage('en').
void i18n.changeLanguage('zh');

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
    getSupportedModes: (h: { modes?: Array<{ id: string }> } | undefined) =>
      h?.modes?.map((m) => m.id) ?? [],
    getDefaultMode: (h: { defaultMode?: string; modes?: Array<{ id: string }> } | undefined) =>
      h?.defaultMode ?? h?.modes?.[0]?.id,
    getMode: (h: { modes?: Array<{ id: string }> } | undefined, id: string) =>
      h?.modes?.find((m) => m.id === id),
    usesShellEditor: (h: { modes?: Array<{ kind: string }> } | undefined) =>
      !!h?.modes?.some((m) => m.kind === 'shell-editor'),
    getModeComponent: (h: { modes?: Array<{ id: string; kind: string; component?: unknown }> } | undefined, id: string) => {
      const m = h?.modes?.find((mm) => mm.id === id);
      return m?.kind === 'component' ? m.component : undefined;
    },
    listProviders: (ext: string) => instance.listProviders(ext),
    resolveDefault: (ext: string) => instance.resolveDefault(ext),
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
