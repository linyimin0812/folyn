import { vi } from 'vitest';

type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  encoding?: string;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const outcomes = new Map<string, CommandResult>();

export class Command {
  constructor(
    public program: string,
    public args: string | string[] = [],
    public options?: SpawnOptions,
  ) {}

  async execute(): Promise<CommandResult> {
    const key = `${this.program} ${Array.isArray(this.args) ? this.args.join(' ') : this.args}`;
    const preset = outcomes.get(key);
    if (preset) return preset;
    return { code: 0, stdout: '', stderr: '' };
  }

  static setOutcome(key: string, result: CommandResult) {
    outcomes.set(key, result);
  }

  static clearOutcomes() {
    outcomes.clear();
  }
}

export const __internals = {
  reset() {
    Command.clearOutcomes();
  },
};
