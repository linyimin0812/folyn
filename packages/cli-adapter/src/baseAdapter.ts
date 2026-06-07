import type { CliAdapter, CliAdapterConfig, CliEventHandler, CliSendOptions, CliStreamEvent } from './types';

export abstract class BaseCliAdapter implements CliAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly description: string;

  protected handlers: CliEventHandler[] = [];
  protected config: CliAdapterConfig | null = null;

  abstract start(config: CliAdapterConfig): Promise<void>;
  abstract send(prompt: string, options?: CliSendOptions): Promise<void>;
  abstract stop(): Promise<void>;
  abstract isRunning(): boolean;

  onEvent(handler: CliEventHandler): void {
    this.handlers.push(handler);
  }

  offEvent(handler: CliEventHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  protected emit(event: CliStreamEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }
}
