import type { FileTypeHandler } from './types';
import { OwnedRegistry, FOLYN_CORE_OWNER } from '@folyn/plugin-host';

/**
 * Map-backed file-type handler registry with extension indexing + priority
 * resolution (doc §25).
 *
 * Extracted from `registry.ts` so the register/unregister/extension-routing
 * logic is unit-testable in isolation — `registry.ts` still owns build-time
 * built-in discovery via `import.meta.glob`, which pulls in @excalidraw and
 * cannot run under jsdom. Tests drive this class directly.
 *
 * Ownership: every registration carries an `ownerExtensionId` (default
 * {@link FOLYN_CORE_OWNER}) so a plugin reload/deactivate can bulk-remove its
 * handlers via {@link removeByOwner}. `register` returns a disposable that
 * removes the handler only if it is still the same instance (the
 * plugin-uninstall safe path: a late `dispose()` after a re-registration must
 * not evict the newer handler).
 *
 * Resolution (doc §25): each extension maps to a candidate list keyed by
 * handler id; {@link getByExtension} returns the highest-`priority` candidate
 * (ties: last registered). So a specialized provider (priority 5000)
 * overrides the generic File Viewer (priority -1000).
 */
export class HandlerRegistry {
  private readonly owned = new OwnedRegistry<FileTypeHandler>((h) => h.id);
  /** ext → set of handler ids claiming it (priority resolves which wins). */
  private readonly extMap = new Map<string, Set<string>>();
  private readonly aliases: Record<string, string>;

  constructor(aliases: Record<string, string> = {}) {
    this.aliases = aliases;
  }

  register(handler: FileTypeHandler, ownerExtensionId: string = FOLYN_CORE_OWNER): { dispose: () => void } {
    // Index every extension the handler claims BEFORE delegating ownership,
    // so re-registration cleanly updates the candidate set.
    for (const ext of handler.extensions) {
      let set = this.extMap.get(ext);
      if (!set) {
        set = new Set();
        this.extMap.set(ext, set);
      }
      set.add(handler.id);
    }
    return this.owned.register(handler, ownerExtensionId);
  }

  unregister(id: string): boolean {
    const handler = this.owned.get(id);
    if (!handler) return false;
    const removed = this.owned.remove(id);
    if (removed) {
      for (const ext of handler.extensions) {
        this.pruneExtension(ext, id);
      }
    }
    return removed;
  }

  removeByOwner(ownerExtensionId: string): void {
    for (const handler of this.owned.list()) {
      if (this.owned.ownerOf(handler.id) === ownerExtensionId) {
        for (const ext of handler.extensions) {
          this.pruneExtension(ext, handler.id);
        }
      }
    }
    this.owned.removeByOwner(ownerExtensionId);
  }

  /** Resolve the highest-priority handler for an extension (doc §25). */
  getByExtension(ext: string): FileTypeHandler | undefined {
    return this.resolveDefault(ext);
  }

  /** All handlers claiming this extension, highest priority first;
   * ties broken by registration order (last registered wins) (doc §25/§26). */
  listProviders(ext: string): FileTypeHandler[] {
    const ids = this.extMap.get(ext);
    if (!ids || ids.size === 0) return [];
    // Array.from preserves insertion order (registration order).
    const ordered = Array.from(ids);
    return ordered
      .map((id, idx) => ({ h: this.owned.get(id), idx }))
      .filter((e): e is { h: FileTypeHandler; idx: number } => !!e.h)
      .sort((a, b) => (b.h.priority ?? 0) - (a.h.priority ?? 0) || b.idx - a.idx)
      .map((e) => e.h);
  }

  /** The default (highest-priority) provider for an extension. */
  resolveDefault(ext: string): FileTypeHandler | undefined {
    return this.listProviders(ext)[0];
  }

  getById(id: string): FileTypeHandler | undefined {
    return this.owned.get(id) ?? this.owned.get(this.aliases[id] ?? id);
  }

  getAll(): FileTypeHandler[] {
    return this.owned.list();
  }

  /** Test-only: reset the registry between tests (used by test/setup.desktop.ts). */
  clear(): void {
    this.owned.clear();
    this.extMap.clear();
  }

  /** Remove `id` from an extension's candidate set; drop the set when empty. */
  private pruneExtension(ext: string, id: string): void {
    const set = this.extMap.get(ext);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) this.extMap.delete(ext);
  }
}
