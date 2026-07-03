// @vitest-environment jsdom
/**
 * Query module tests (PR4).
 *
 * jq-wasm is mocked because its WASM blob loads via `fetch(wasmUrl)`, which
 * cannot resolve a `file://` URL in vitest's jsdom env. The mock lets us
 * verify that `executeJq` delegates to jq-wasm's `json()` with the right
 * arguments and propagates errors correctly.
 *
 * `jsonpath-plus` is real (pure JS, no WASM); the JSONPath tests exercise
 * actual JSONPath behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jq-wasm mock — must be hoisted before the dynamic import in `executeJq`.
const jqJsonMock = vi.fn<(input: string | object, query: string, flags?: string[]) => Promise<unknown>>();
vi.mock('jq-wasm', () => ({
  json: (input: string | object, query: string, flags?: string[]) => jqJsonMock(input, query, flags),
}));

import { runJq, runJsonPath, runQuery } from './query';

describe('runJq — via executeJq (worker module imported directly)', () => {
  beforeEach(() => {
    jqJsonMock.mockReset();
  });

  it('returns jq result for .users[].name', async () => {
    const input = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
    jqJsonMock.mockResolvedValue(['Alice', 'Bob']);
    const result = await runJq(input, '.users[].name');
    expect(result).toEqual(['Alice', 'Bob']);
    expect(jqJsonMock).toHaveBeenCalledTimes(1);
    const [arg0, arg1] = jqJsonMock.mock.calls[0];
    expect(arg0).toBe(input); // passed as object, not re-serialized
    expect(arg1).toBe('.users[].name');
  });

  it('returns jq result for .a.b on nested object', async () => {
    jqJsonMock.mockResolvedValue(1);
    const result = await runJq({ a: { b: 1 } }, '.a.b');
    expect(result).toBe(1);
  });

  it('throws on empty expression', async () => {
    await expect(runJq({ a: 1 }, '')).rejects.toThrow(/empty expression/);
    expect(jqJsonMock).not.toHaveBeenCalled();
  });

  it('propagates jq-wasm errors with descriptive message', async () => {
    jqJsonMock.mockRejectedValue(new Error('jq: syntax error near .'));
    await expect(runJq({ a: 1 }, '.')).rejects.toThrow(/syntax error/);
  });
});

describe('runJsonPath — real jsonpath-plus', () => {
  it('returns $.users[*].name as array', async () => {
    const input = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
    const result = await runJsonPath(input, '$.users[*].name');
    expect(result).toEqual(['Alice', 'Bob']);
  });

  it('returns scalar for $.a.b', async () => {
    const result = await runJsonPath({ a: { b: 1 } }, '$.a.b');
    // jsonpath-plus returns an array of matches by default
    expect(result).toEqual([1]);
  });

  it('returns empty array for no matches', async () => {
    const result = await runJsonPath({ a: 1 }, '$.nonexistent');
    expect(result).toEqual([]);
  });

  it('throws on empty expression', async () => {
    await expect(runJsonPath({ a: 1 }, '')).rejects.toThrow(/empty expression/);
  });

  it('throws on malformed expression', async () => {
    await expect(runJsonPath({ a: 1 }, '$..[?(@.a >)]')).rejects.toThrow(/jsonpath:/);
  });
});

describe('runQuery — dispatcher', () => {
  beforeEach(() => {
    jqJsonMock.mockReset();
  });

  it('dispatches to jq when lang=jq', async () => {
    jqJsonMock.mockResolvedValue(['Alice']);
    const result = await runQuery('jq', { users: [{ name: 'Alice' }] }, '.users[].name');
    expect(result).toEqual(['Alice']);
    expect(jqJsonMock).toHaveBeenCalledTimes(1);
  });

  it('dispatches to jsonpath when lang=jsonpath', async () => {
    const result = await runQuery('jsonpath', { users: [{ name: 'Alice' }] }, '$.users[*].name');
    expect(result).toEqual(['Alice']);
  });
});
