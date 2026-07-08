import { vi } from 'vitest';

export const readText = vi.fn(async () => '');
export const writeText = vi.fn(async () => undefined);

export const __internals = {
  reset() {
    readText.mockClear();
    writeText.mockClear();
    readText.mockResolvedValue('');
    writeText.mockResolvedValue(undefined);
  },
};
