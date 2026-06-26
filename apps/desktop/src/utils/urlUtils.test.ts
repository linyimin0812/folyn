import { describe, it, expect } from 'vitest';
import { normalizeUrl } from './urlUtils';

describe('normalizeUrl', () => {
  it('lowercases the host', () => {
    expect(normalizeUrl('https://Example.com/Path')).toBe('https://example.com/Path');
  });

  it('strips the fragment', () => {
    expect(normalizeUrl('https://example.com/a?b=1#x')).toBe('https://example.com/a?b=1');
  });

  it('strips a trailing slash but keeps the path', () => {
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a');
  });

  it('strips multiple trailing slashes', () => {
    expect(normalizeUrl('https://example.com/a//')).toBe('https://example.com/a');
  });

  it('keeps the query string', () => {
    expect(normalizeUrl('https://example.com/a/?b=1&c=2#frag')).toBe(
      'https://example.com/a?b=1&c=2',
    );
  });

  it('normalizes a root url with trailing slash to bare origin', () => {
    expect(normalizeUrl('https://site.com/')).toBe('https://site.com');
  });

  it('normalizes a bare root url to itself (no trailing slash added)', () => {
    expect(normalizeUrl('https://site.com')).toBe('https://site.com');
  });

  it('is idempotent on already-normalized urls', () => {
    const normalized = 'https://example.com/a?b=1';
    expect(normalizeUrl(normalized)).toBe(normalized);
  });

  it('preserves the port', () => {
    expect(normalizeUrl('http://localhost:3000/a/')).toBe('http://localhost:3000/a');
  });

  it('passes through invalid input unchanged', () => {
    expect(normalizeUrl('not a url')).toBe('not a url');
  });

  it('passes through non-http protocols unchanged', () => {
    expect(normalizeUrl('ftp://example.com/a/')).toBe('ftp://example.com/a/');
  });

  it('lowercases host while preserving case in path and query', () => {
    expect(normalizeUrl('https://API.Site.com/Users?Name=Bob')).toBe(
      'https://api.site.com/Users?Name=Bob',
    );
  });
});
