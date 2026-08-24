import { describe, it, expect, beforeEach } from 'vitest';
import { sessionStorage } from './sessionStorage';
import {
  readTextFile,
  exists,
  mkdir,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

const VAULT = 'vault-1';

async function readJson(p: string): Promise<unknown> {
  return JSON.parse(await readTextFile(p));
}

describe('sessionStorage', () => {
  beforeEach(() => {
    // FS mock auto-resets in setup.ts; ensure clean state per test.
  });

  it('persists and reloads a session as JSON', async () => {
    await sessionStorage.saveSession(VAULT, 's1', { foo: 1 });
    const loaded = await sessionStorage.loadSession<{ foo: number }>(VAULT, 's1');
    expect(loaded).toEqual({ foo: 1 });
  });

  it('returns null when loading a missing session', async () => {
    expect(await sessionStorage.loadSession(VAULT, 'missing')).toBeNull();
  });

  it('deletes an existing session file', async () => {
    await sessionStorage.saveSession(VAULT, 's2', { x: 2 });
    await sessionStorage.deleteSession(VAULT, 's2');
    expect(await sessionStorage.loadSession(VAULT, 's2')).toBeNull();
  });

  it('does not throw when deleting a missing session', async () => {
    await expect(sessionStorage.deleteSession(VAULT, 'never')).resolves.toBeUndefined();
  });

  it('lists session ids, excluding _meta.json and non-json files', async () => {
    await sessionStorage.saveSession(VAULT, 'a', { a: 1 });
    await sessionStorage.saveSession(VAULT, 'b', { b: 2 });
    await sessionStorage.saveMeta(VAULT, { activeSessionId: 'a' });
    const ids = await sessionStorage.listSessionIds(VAULT);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('returns an empty list when the vault directory does not exist', async () => {
    expect(await sessionStorage.listSessionIds('no-such-vault')).toEqual([]);
  });

  it('persists and reloads meta', async () => {
    await sessionStorage.saveMeta(VAULT, { activeSessionId: 's-meta' });
    expect(await sessionStorage.loadMeta(VAULT)).toEqual({ activeSessionId: 's-meta' });
  });

  it('returns null when meta is missing', async () => {
    expect(await sessionStorage.loadMeta('no-meta-vault')).toBeNull();
  });

  it('writes files under ~/.folyn/vaults/<vaultId>/', async () => {
    await sessionStorage.saveSession(VAULT, 'path-check', { ok: true });
    const expected = '/mock/home/.folyn/vaults/vault-1/path-check.json';
    expect(await readJson(expected)).toEqual({ ok: true });
  });

  it('returns null on corrupted JSON instead of throwing', async () => {
    // Manually place a corrupted file under the expected path.
    await mkdir('/mock/home/.folyn/vaults/vault-1');
    await writeTextFile('/mock/home/.folyn/vaults/vault-1/broken.json', '{not valid json');
    expect(await sessionStorage.loadSession(VAULT, 'broken')).toBeNull();
  });

  it('ensureDir is idempotent — does not re-create existing directory', async () => {
    await sessionStorage.saveSession(VAULT, 'first', { a: 1 });
    expect(await exists('/mock/home/.folyn/vaults/vault-1')).toBe(true);
    await sessionStorage.saveSession(VAULT, 'second', { b: 2 });
    // still exists, no throw
    expect(await exists('/mock/home/.folyn/vaults/vault-1')).toBe(true);
  });
});
