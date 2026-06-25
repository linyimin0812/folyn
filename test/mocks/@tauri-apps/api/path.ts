import { vi } from 'vitest';

export const appDataDir = vi.fn(async () => '/mock/appdata');
export const homeDir = vi.fn(async () => '/mock/home');
export const join = vi.fn(async (...parts: string[]) =>
  parts
    .filter((p) => p !== '' && p !== undefined && p !== null)
    .join('/')
    .replace(/\/+/g, '/'),
);

export const __internals = {
  reset() {
    appDataDir.mockClear();
    homeDir.mockClear();
    join.mockClear();
    appDataDir.mockResolvedValue('/mock/appdata');
    homeDir.mockResolvedValue('/mock/home');
  },
};
