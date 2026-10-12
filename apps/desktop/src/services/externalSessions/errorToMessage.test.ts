/**
 * Unit tests for the rejection-stringifier. The shapes mirror the real
 * rejection values that reach the sessions UI:
 *  - Rust `AppError` serialized as `{category, detail}` (chat_stream and
 *    every AppError-returning invoke),
 *  - provider/HTTP bridge objects `{status, error}` / `{status, message}`,
 *  - plain Errors and strings.
 * A plain `String(err)` yields "[object Object]" for all the object shapes —
 * the bug these tests pin down.
 */
import { describe, it, expect } from 'vitest';
import { errorToMessage } from './errorToMessage';

describe('errorToMessage', () => {
  it('Error → its message', () => {
    expect(errorToMessage(new Error('boom'))).toBe('boom');
  });

  it('string → itself', () => {
    expect(errorToMessage('plain failure')).toBe('plain failure');
  });

  it('Rust AppError shape {category, detail} → "category: detail"', () => {
    expect(errorToMessage({ category: 'internal', detail: 'request failed' }))
      .toBe('internal: request failed');
  });

  it('{message} object → its message', () => {
    expect(errorToMessage({ message: 'unauthorized' })).toBe('unauthorized');
  });

  it('{status, error} → status prefixed', () => {
    expect(errorToMessage({ status: 401, error: 'invalid api key' }))
      .toBe('401: invalid api key');
  });

  it('{status, error: {message}} → nested message with status prefix', () => {
    expect(errorToMessage({ status: 500, error: { message: 'upstream timeout' } }))
      .toBe('500: upstream timeout');
  });

  it('unexpected object shape → its JSON fields, never "[object Object]"', () => {
    expect(errorToMessage({ weird: 1 })).toBe('{"weird":1}');
  });

  it('null/undefined/number degrade to their string form', () => {
    expect(errorToMessage(null)).toBe('null');
    expect(errorToMessage(undefined)).toBe('undefined');
    expect(errorToMessage(42)).toBe('42');
  });
});
