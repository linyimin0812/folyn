import type { FileTypeHandler } from './types';
import { HandlerRegistry } from './HandlerRegistry';

/**
 * File-type handler registry.
 *
 * Built-in handlers are discovered at build time via `import.meta.glob` and
 * registered once at module load. {@link registerFileTypeHandler} /
 * {@link unregisterFileTypeHandler} expose the registry as the contribution
 * target for plugins (PR3 trusted tier): a plugin can register a handler for
 * a new extension at runtime and it takes effect immediately, and is removed
 * on uninstall.
 *
 * Public read API (`getHandlerByExtension` / `getHandlerById` /
 * `getAllHandlers`) is unchanged so existing call sites behave identically.
 * The Map/extension-index logic lives in {@link HandlerRegistry} so it can be
 * unit-tested without triggering the eager glob (which pulls @excalidraw).
 */

const registry = new HandlerRegistry({
  text: 'markdown',
});

/** Register a file-type handler. Replaces any prior handler with the same id. */
export function registerFileTypeHandler(handler: FileTypeHandler): { dispose: () => void } {
  return registry.register(handler);
}

/** Remove a handler by id. Returns true if a handler was removed. */
export function unregisterFileTypeHandler(id: string): boolean {
  return registry.unregister(id);
}

export function getHandlerByExtension(ext: string): FileTypeHandler | undefined {
  return registry.getByExtension(ext);
}

export function getHandlerById(id: string): FileTypeHandler | undefined {
  return registry.getById(id);
}

export function getAllHandlers(): FileTypeHandler[] {
  return registry.getAll();
}

// ── Built-in discovery ──────────────────────────────────────────────────────
const modules = import.meta.glob<{ default: FileTypeHandler }>(
  './*/index.{ts,tsx}',
  { eager: true },
);

for (const m of Object.values(modules)) {
  registry.register(m.default);
}
