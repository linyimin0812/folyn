import { describe, it, expect } from 'vitest';
import {
  parseInput,
  parseInputWithMode,
  ParseError,
  type InputMode,
} from './parseInput';

const enc = (s: string): string => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};

describe('parseInput — auto-detect (positive)', () => {
  it('parses plain JSON as json5', async () => {
    const value = await parseInput('{"a":1}');
    expect(value).toEqual({ a: 1 });
  });

  it('parses JSON5 with comments + unquoted keys as json5', async () => {
    const value = await parseInput('{ a: 1, /* x */ b: 2, }');
    expect(value).toEqual({ a: 1, b: 2 });
  });

  it('parses escaped JSON string to inner object', async () => {
    const value = await parseInput('"{\\"key\\":\\"value\\"}"');
    expect(value).toEqual({ key: 'value' });
  });

  it('parses single-quoted escaped JSON string', async () => {
    const value = await parseInput('\'{"k":1}\'');
    expect(value).toEqual({ k: 1 });
  });

  it('parses base64-encoded JSON', async () => {
    const value = await parseInput(enc('{"x": 42}'));
    expect(value).toEqual({ x: 42 });
  });

  it('parses base64-encoded escaped JSON (falls through to escaped)', async () => {
    // The decoded text is itself a quoted JSON literal.
    const inner = '"{\\"n\\":1}"';
    const value = await parseInput(enc(inner));
    expect(value).toEqual({ n: 1 });
  });

  it('parses YAML mapping', async () => {
    const value = await parseInput('key: value');
    expect(value).toEqual({ key: 'value' });
  });

  it('parses XML with text kept as string', async () => {
    const value = await parseInput('<root><a>1</a></root>');
    expect(value).toEqual({ root: { a: '1' } });
  });

  it('parses XML attributes with @_ prefix', async () => {
    const value = await parseInput('<root id="x"><a>1</a></root>');
    expect(value).toEqual({ root: { '@_id': 'x', a: '1' } });
  });

  it('parses CSV with header row as array of records', async () => {
    const value = await parseInput('name,age\nAlice,30\nBob,40');
    expect(value).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '40' },
    ]);
  });

  it('parses TSV (tab-separated) from Excel clipboard', async () => {
    const value = await parseInput('name\tage\nAlice\t30\nBob\t40');
    expect(value).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '40' },
    ]);
  });

  it('preserves array root for CSV (no wrapper object)', async () => {
    const value = await parseInput('a,b\n1,2');
    expect(Array.isArray(value)).toBe(true);
  });
});

describe('parseInput — auto-detect precedence', () => {
  it('claims `{"a":1}` as json5, not escaped/base64', async () => {
    const result = await parseInputWithMode('{"a":1}');
    expect(result.mode).toBe('json5');
  });

  it('claims a quoted JSON literal as escaped, not json5', async () => {
    const result = await parseInputWithMode('"{\\"k\\":1}"');
    expect(result.mode).toBe('escaped');
    expect(result.value).toEqual({ k: 1 });
  });

  it('claims base64 of JSON as base64', async () => {
    const result = await parseInputWithMode(enc('{"y":7}'));
    expect(result.mode).toBe('base64');
  });

  it('claims YAML mapping as yaml', async () => {
    const result = await parseInputWithMode('foo: bar');
    expect(result.mode).toBe('yaml');
  });

  it('claims XML as xml (yaml does not shadow it)', async () => {
    const result = await parseInputWithMode('<r><a>1</a></r>');
    expect(result.mode).toBe('xml');
  });

  it('claims CSV as csv', async () => {
    const result = await parseInputWithMode('h1,h2\nv1,v2');
    expect(result.mode).toBe('csv');
  });
});

describe('parseInput — per-format explicit mode (positive)', () => {
  it('json5 mode parses JSON5', async () => {
    const value = await parseInput('{ x: 1, } // comment', 'json5');
    expect(value).toEqual({ x: 1 });
  });

  it('escaped mode parses quoted JSON', async () => {
    const value = await parseInput('"{\\"a\\":1}"', 'escaped');
    expect(value).toEqual({ a: 1 });
  });

  it('base64 mode decodes + parses', async () => {
    const value = await parseInput(enc('{"z":9}'), 'base64');
    expect(value).toEqual({ z: 9 });
  });

  it('yaml mode parses YAML', async () => {
    const value = await parseInput('a: 1\nb: 2', 'yaml');
    expect(value).toEqual({ a: 1, b: 2 });
  });

  it('xml mode parses XML', async () => {
    const value = await parseInput('<r><a>1</a></r>', 'xml');
    expect(value).toEqual({ r: { a: '1' } });
  });

  it('csv mode parses CSV', async () => {
    const value = await parseInput('k,v\n1,2', 'csv');
    expect(value).toEqual([{ k: '1', v: '2' }]);
  });
});

describe('parseInput — negative cases', () => {
  it('json5 mode rejects malformed input', async () => {
    await expect(parseInput('{a: ', 'json5')).rejects.toBeInstanceOf(ParseError);
  });

  it('escaped mode rejects non-quoted input', async () => {
    await expect(parseInput('not quoted', 'escaped')).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('escaped mode rejects quoted input whose inner is not JSON', async () => {
    await expect(parseInput('"not json"', 'escaped')).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('base64 mode rejects non-base64 input', async () => {
    await expect(parseInput('!!!notbase64!!!', 'base64')).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('base64 mode rejects base64 that decodes to non-JSON', async () => {
    await expect(parseInput('aGVsbG8=', 'base64')).rejects.toBeInstanceOf(
      ParseError,
    ); // "hello"
  });

  it('yaml mode rejects malformed YAML', async () => {
    await expect(parseInput(': : :', 'yaml')).rejects.toBeInstanceOf(ParseError);
  });

  it('xml mode rejects malformed XML', async () => {
    await expect(parseInput('<<< broken', 'xml')).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('csv mode rejects structurally broken CSV', async () => {
    // papaparse is permissive; feed it something that produces parse errors.
    // A quoted field with a missing close quote triggers a quote mismatch.
    await expect(parseInput('a,b\n"unterminated,2', 'csv')).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('auto mode throws ParseError listing attempted formats when all fail', async () => {
    let err: unknown;
    try {
      await parseInput('@@@ not any format @@@');
      throw new Error('should have thrown');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ParseError);
    const pe = err as ParseError;
    expect(pe.attempted.length).toBe(6);
    const modes = pe.attempted.map((a) => a.mode);
    expect(modes).toEqual([
      'json5',
      'escaped',
      'base64',
      'yaml',
      'xml',
      'csv',
    ]);
  });
});

describe('parseInput — edge cases', () => {
  it('throws ParseError on null/undefined content', async () => {
    // @ts-expect-error deliberately invalid input
    await expect(parseInput(null)).rejects.toBeInstanceOf(ParseError);
  });

  it('accepts a JSON array root in auto mode', async () => {
    const value = await parseInput('[1, 2, 3]');
    expect(value).toEqual([1, 2, 3]);
  });

  it('does not wrap CSV result in an object', async () => {
    const value = await parseInput('a,b\n1,2\n3,4', 'csv');
    expect(Array.isArray(value)).toBe(true);
    expect(value).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });
});

// Keep InputMode referenced for type-export smoke check.
export type _InputModeSmoke = InputMode;
