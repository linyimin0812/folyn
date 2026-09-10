/**
 * Owned registry contract — the base every contribution registry implements.
 *
 * Every registration carries an `ownerExtensionId` so a plugin reload /
 * deactivate can bulk-remove everything it contributed without holding the
 * individual disposables (doc §34, §58). `register` returns a `Disposable`
 * that removes the value only if it is still the same instance (the
 * plugin-uninstall safe path: a late dispose after a re-registration must not
 * evict the newer value).
 *
 * Concrete registries (`commandRegistry`, `HandlerRegistry`,
 * `ContainerRegistry`) keep their specialized lookup methods and delegate to
 * an {@link OwnedRegistry} instance for ownership tracking.
 */

import type { Disposable } from './Disposable';

/** Synthetic owner for Folyn's own (builtin, non-extension) registrations. */
export const FOLYN_CORE_OWNER = 'folyn.core';

export interface Registry<T> {
  register(value: T, ownerExtensionId: string): Disposable;
  get(id: string): T | undefined;
  list(): T[];
  remove(id: string): boolean;
  removeByOwner(ownerExtensionId: string): void;
}

interface Entry<T> {
  value: T;
  ownerExtensionId: string;
}

/**
 * Generic owned-registry helper. Concrete registries pass an `idFor` accessor
 * (values don't share one key name — `Command.id`, `FileTypeHandler.id`,
 * `ContainerPlugin.name`) and may layer their own specialized methods on top.
 */
export class OwnedRegistry<T> implements Registry<T> {
  private readonly byId = new Map<string, Entry<T>>();

  constructor(private readonly idFor: (value: T) => string) {}

  register(value: T, ownerExtensionId: string): Disposable {
    const id = this.idFor(value);
    this.byId.set(id, { value, ownerExtensionId });
    const self = this;
    return {
      dispose() {
        const existing = self.byId.get(id);
        if (existing?.value === value) self.byId.delete(id);
      },
    };
  }

  get(id: string): T | undefined {
    return this.byId.get(id)?.value;
  }

  list(): T[] {
    return Array.from(this.byId.values()).map((e) => e.value);
  }

  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  removeByOwner(ownerExtensionId: string): void {
    for (const [id, entry] of this.byId) {
      if (entry.ownerExtensionId === ownerExtensionId) {
        this.byId.delete(id);
      }
    }
  }

  /** Owner of a registered id, or `undefined` if absent. Test/diagnostic helper. */
  ownerOf(id: string): string | undefined {
    return this.byId.get(id)?.ownerExtensionId;
  }

  /** Test-only: reset between tests. */
  clear(): void {
    this.byId.clear();
  }
}
