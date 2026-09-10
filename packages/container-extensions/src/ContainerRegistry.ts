import type { ContainerExtension, ContainerCategory } from './ContainerExtension';
import { OwnedRegistry, FOLYN_CORE_OWNER } from 'folyn-extension-sdk';

/**
 * Singleton registry for container extensions.
 * Extensions register here and are consumed by:
 * - SlashCommandExtension (editor menu)
 * - ContainerRenderer (preview pane)
 *
 * Ownership: every registration carries an `ownerExtensionId` (default
 * {@link FOLYN_CORE_OWNER}) so a extension reload/deactivate can bulk-remove
 * its containers via {@link removeByOwner}. `register` returns a disposable
 * that removes the container only if it is still the same instance.
 */
export class ContainerRegistry {
  private static instance: ContainerRegistry;
  private readonly owned = new OwnedRegistry<ContainerExtension>((p) => p.name);

  private constructor() {}

  static getInstance(): ContainerRegistry {
    if (!ContainerRegistry.instance) {
      ContainerRegistry.instance = new ContainerRegistry();
    }
    return ContainerRegistry.instance;
  }

  /** Register a container extension owned by `ownerExtensionId` (default Folyn core). */
  register(extension: ContainerExtension, ownerExtensionId: string = FOLYN_CORE_OWNER): { dispose: () => void } {
    return this.owned.register(extension, ownerExtensionId);
  }

  /** Get a extension by directive name */
  get(name: string): ContainerExtension | undefined {
    return this.owned.get(name);
  }

  /** Get all registered extensions */
  getAll(): ContainerExtension[] {
    return this.owned.list();
  }

  /** Get extensions filtered by category */
  getByCategory(category: ContainerCategory): ContainerExtension[] {
    return this.getAll().filter((extension) => extension.category === category);
  }

  /** Check if a extension is registered */
  has(name: string): boolean {
    return this.owned.get(name) !== undefined;
  }

  /** Unregister a extension */
  unregister(name: string): boolean {
    return this.owned.remove(name);
  }

  /** Remove every container contributed by `ownerExtensionId` (reload/deactivate). */
  removeByOwner(ownerExtensionId: string): void {
    this.owned.removeByOwner(ownerExtensionId);
  }
}
