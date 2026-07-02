import { describe, it, expect } from 'vitest';
import { parseCsv } from './csvParse';

describe('parseCsv', () => {
  it('parses a simple row without trailing newline', () => {
    expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('parses multiple rows separated by \\n', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses quoted fields containing commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('parses escaped quotes (`""` -> `"`)', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('parses fields containing newlines', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });

  it('handles \\r\\n line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles \\r\\n inside quoted fields literally', () => {
    // Inside quotes, \r\n is literal content (RFC-4180 field can contain newlines).
    expect(parseCsv('"a\r\nb",c')).toEqual([['a\r\nb', 'c']]);
  });

  it('does not produce an extra empty row for a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('parses a single row with no trailing newline', () => {
    expect(parseCsv('only')).toEqual([['only']]);
  });

  it('handles jagged rows (different field counts)', () => {
    expect(parseCsv('a,b,c\n1,2')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2'],
    ]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('handles a quoted empty field', () => {
    expect(parseCsv('"",b')).toEqual([['', 'b']]);
  });

  it('returns parsed partial for mismatched (unterminated) quotes', () => {
    // Unterminated quote: parse what we have, never throw.
    expect(parseCsv('"unterminated,b')).toEqual([['unterminated,b']]);
  });

  it('handles a lone \\r as a line break outside quotes', () => {
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
