import type { CliAdapter } from './types';
import { ClaudeAdapter } from './claudeAdapter';

export class CliAdapterRegistry {
  private static instance: CliAdapterRegistry;
  private adapters = new Map<string, () => CliAdapter>();

  static getInstance(): CliAdapterRegistry {
    if (!this.instance) {
      this.instance = new CliAdapterRegistry();
    }
    return this.instance;
  }

  register(id: string, factory: () => CliAdapter): void {
    this.adapters.set(id, factory);
  }

  create(id: string): CliAdapter {
    const factory = this.adapters.get(id);
    if (!factory) {
      throw new Error(`CLI adapter "${id}" not found`);
    }
    return factory();
  }

  getAll(): { id: string; displayName: string; description: string }[] {
    return [...this.adapters.entries()].map(([id, factory]) => {
      const instance = factory();
      return { id, displayName: instance.displayName, description: instance.description };
    });
  }
}

export function registerBuiltinAdapters(): void {
  const registry = CliAdapterRegistry.getInstance();
  registry.register('claude', () => new ClaudeAdapter());
}

registerBuiltinAdapters();
