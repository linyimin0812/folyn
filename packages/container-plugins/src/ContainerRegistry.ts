import type { ContainerPlugin, ContainerCategory } from './ContainerPlugin';

/**
 * Singleton registry for container plugins.
 * Plugins register here and are consumed by:
 * - SlashCommandPlugin (editor menu)
 * - ContainerRenderer (preview pane)
 */
export class ContainerRegistry {
  private static instance: ContainerRegistry;
  private plugins = new Map<string, ContainerPlugin>();

  private constructor() {}

  static getInstance(): ContainerRegistry {
    if (!ContainerRegistry.instance) {
      ContainerRegistry.instance = new ContainerRegistry();
    }
    return ContainerRegistry.instance;
  }

  /** Register a container plugin */
  register(plugin: ContainerPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  /** Get a plugin by directive name */
  get(name: string): ContainerPlugin | undefined {
    return this.plugins.get(name);
  }

  /** Get all registered plugins */
  getAll(): ContainerPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get plugins filtered by category */
  getByCategory(category: ContainerCategory): ContainerPlugin[] {
    return this.getAll().filter((plugin) => plugin.category === category);
  }

  /** Check if a plugin is registered */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /** Unregister a plugin */
  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }
}
