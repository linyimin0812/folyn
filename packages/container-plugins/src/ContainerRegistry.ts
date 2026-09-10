import type { ContainerPlugin, ContainerCategory } from './ContainerPlugin';
import { OwnedRegistry, FOLYN_CORE_OWNER } from 'folyn-plugin-sdk';

/**
 * Singleton registry for container plugins.
 * Plugins register here and are consumed by:
 * - SlashCommandPlugin (editor menu)
 * - ContainerRenderer (preview pane)
 *
 * Ownership: every registration carries an `ownerExtensionId` (default
 * {@link FOLYN_CORE_OWNER}) so a plugin reload/deactivate can bulk-remove
 * its containers via {@link removeByOwner}. `register` returns a disposable
 * that removes the container only if it is still the same instance.
 */
export class ContainerRegistry {
  private static instance: ContainerRegistry;
  private readonly owned = new OwnedRegistry<ContainerPlugin>((p) => p.name);

  private constructor() {}

  static getInstance(): ContainerRegistry {
    if (!ContainerRegistry.instance) {
      ContainerRegistry.instance = new ContainerRegistry();
    }
    return ContainerRegistry.instance;
  }

  /** Register a container plugin owned by `ownerExtensionId` (default Folyn core). */
  register(plugin: ContainerPlugin, ownerExtensionId: string = FOLYN_CORE_OWNER): { dispose: () => void } {
    return this.owned.register(plugin, ownerExtensionId);
  }

  /** Get a plugin by directive name */
  get(name: string): ContainerPlugin | undefined {
    return this.owned.get(name);
  }

  /** Get all registered plugins */
  getAll(): ContainerPlugin[] {
    return this.owned.list();
  }

  /** Get plugins filtered by category */
  getByCategory(category: ContainerCategory): ContainerPlugin[] {
    return this.getAll().filter((plugin) => plugin.category === category);
  }

  /** Check if a plugin is registered */
  has(name: string): boolean {
    return this.owned.get(name) !== undefined;
  }

  /** Unregister a plugin */
  unregister(name: string): boolean {
    return this.owned.remove(name);
  }

  /** Remove every container contributed by `ownerExtensionId` (reload/deactivate). */
  removeByOwner(ownerExtensionId: string): void {
    this.owned.removeByOwner(ownerExtensionId);
  }
}
