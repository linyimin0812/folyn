import { vi } from 'vitest';

export const invoke = vi.fn(async () => undefined);
export const convertFileSrc = vi.fn((filePath: string) => `asset://localhost/${filePath}`);

export const __internals = {
  reset() {
    invoke.mockClear();
    convertFileSrc.mockClear();
    invoke.mockResolvedValue(undefined);
  },
};
