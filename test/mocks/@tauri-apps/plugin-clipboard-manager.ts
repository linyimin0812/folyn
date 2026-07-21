import { vi } from 'vitest';

export const readText = vi.fn(async () => '');
export const writeText = vi.fn(async () => undefined);
export const writeImage = vi.fn(async () => undefined);

export const __internals = {
  reset() {
    readText.mockClear();
    writeText.mockClear();
    writeImage.mockClear();
    readText.mockResolvedValue('');
    writeText.mockResolvedValue(undefined);
    writeImage.mockResolvedValue(undefined);
  },
};
