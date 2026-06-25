import { describe, it, expect, beforeEach } from 'vitest';
import { resolveBasePath } from './pathResolver';
import { homeDir } from '@tauri-apps/api/path';

describe('resolveBasePath', () => {
  beforeEach(() => {
    homeDir.mockResolvedValue('/mock/home');
  });

  it('returns the path unchanged when it does not start with ~', async () => {
    expect(await resolveBasePath('/var/data/notes')).toBe('/var/data/notes');
  });

  it('expands ~ to the home directory', async () => {
    expect(await resolveBasePath('~/notes')).toBe('/mock/home/notes');
  });

  it('expands a bare ~ to the home directory with no trailing slash', async () => {
    expect(await resolveBasePath('~')).toBe('/mock/home');
  });

  it('strips trailing slashes from the result', async () => {
    expect(await resolveBasePath('/var/data/')).toBe('/var/data');
  });

  it('strips multiple trailing slashes', async () => {
    expect(await resolveBasePath('/var/data///')).toBe('/var/data');
  });
});
