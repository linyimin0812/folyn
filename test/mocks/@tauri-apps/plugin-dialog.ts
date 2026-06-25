import { vi } from 'vitest';

export const open = vi.fn(async () => null);
export const save = vi.fn(async () => null);

export const __internals = {
  reset() {
    open.mockClear();
    save.mockClear();
    open.mockResolvedValue(null);
    save.mockResolvedValue(null);
  },
};
