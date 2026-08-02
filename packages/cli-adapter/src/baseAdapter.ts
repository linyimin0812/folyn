import type { CliAdapter, CliAdapterConfig, CliEventHandler, CliStreamEvent, CommandEntry, SkillEntry } from './types';

/**
 * Abstract base for CLI adapters. Owns the event-handler registry and the
 * `emit` fan-out so concrete adapters don't duplicate it.
 *
 * Spec: `.trellis/spec/cli-adapter/frontend/{component,quality}-guidelines.md`
 * — every adapter extends `BaseCliAdapter` (do not implement `CliAdapter`
 * directly); `onEvent`/`offEvent`/`emit` live here.
 */
export abstract class BaseCliAdapter implements CliAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly description: string;

  protected handlers: CliEventHandler[] = [];
  protected config: CliAdapterConfig | null = null;

  abstract start(config: CliAdapterConfig): Promise<void>;
  abstract send(prompt: string, options?: import('./types').CliSendOptions): Promise<void>;
  abstract stop(): Promise<void>;
  abstract isRunning(): boolean;

  /** Default: no discoverable skills. Adapters that read skills from disk
   *  override this. Returns [] when not started. */
  async listSkills(): Promise<SkillEntry[]> {
    return [];
  }

  /** Default: no discoverable commands. Adapters that read commands from
   *  disk override this. Returns [] when not started. */
  async listCommands(): Promise<CommandEntry[]> {
    return [];
  }

  onEvent(handler: CliEventHandler): void {
    this.handlers.push(handler);
  }

  offEvent(handler: CliEventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  protected emit(event: CliStreamEvent): void {
    for (const handler of this.handlers) handler(event);
  }
}
