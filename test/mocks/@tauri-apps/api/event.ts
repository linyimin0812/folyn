import { vi } from 'vitest';

export const listen = vi.fn(async () => () => {});
export const emit = vi.fn(async () => undefined);
export const unlisten = vi.fn(async () => undefined);

export const __internals = {
  reset() {
    listen.mockClear();
    emit.mockClear();
    unlisten.mockClear();
    listen.mockResolvedValue(() => {});
  },
};
