import type { FileTypeHandler } from './types';

/**
 * Map-backed file-type handler registry with extension indexing.
 *
 * Extracted from `registry.ts` so the register/unregister/extension-routing
 * logic is unit-testable in isolation — `registry.ts` still owns build-time
 * built-in discovery via `import.meta.glob`, which pulls in @excalidraw and
 * cannot run under jsdom. Tests drive this class directly.
 *
 * `register` returns a disposable that removes the handler only if it is still
 * the same instance (the plugin-uninstall safe path: a late `dispose()` after
 * a re-registration must not evict the newer handler).
 */
export class HandlerRegistry {
  private readonly handlers = new Map<string, FileTypeHandler>();
  private readonly extMap = new Map<string, string>(); // ext -> handler id
  private readonly aliases: Record<string, string>;

  constructor(aliases: Record<string, string> = {}) {
    this.aliases = aliases;
  }

  register(handler: FileTypeHandler): { dispose: () => void } {
    this.handlers.set(handler.id, handler);
    for (const ext of handler.extensions) {
      this.extMap.set(ext, handler.id);
    }
    return {
      dispose: () => {
        const existing = this.handlers.get(handler.id);
        if (existing !== handler) return;
        this.handlers.delete(handler.id);
        for (const ext of handler.extensions) {
          if (this.extMap.get(ext) === handler.id) this.extMap.delete(ext);
        }
      },
    };
  }

  unregister(id: string): boolean {
    const handler = this.handlers.get(id);
    if (!handler) return false;
    this.handlers.delete(id);
    for (const ext of handler.extensions) {
      if (this.extMap.get(ext) === id) this.extMap.delete(ext);
    }
    return true;
  }

  getByExtension(ext: string): FileTypeHandler | undefined {
    const id = this.extMap.get(ext);
    return id ? this.handlers.get(id) : undefined;
  }

  getById(id: string): FileTypeHandler | undefined {
    return this.handlers.get(id) ?? this.handlers.get(this.aliases[id] ?? id);
  }

  getAll(): FileTypeHandler[] {
    return Array.from(this.handlers.values());
  }

  /** Test-only: reset the registry between tests (used by test/setup.desktop.ts). */
  clear(): void {
    this.handlers.clear();
    this.extMap.clear();
  }
}
