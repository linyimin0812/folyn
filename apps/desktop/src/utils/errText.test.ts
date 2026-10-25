import { describe, it, expect } from 'vitest';
import { errText } from './errText';

describe('errText', () => {
  it('uses message from Error', () => {
    expect(errText(new Error('boom'))).toBe('boom');
  });

  it('uses message from plain objects (Tauri invoke shape)', () => {
    expect(errText({ message: 'fs denied' })).toBe('fs denied');
  });

  it('uses error field when message is absent', () => {
    expect(errText({ error: 'not allowed' })).toBe('not allowed');
  });

  it('JSON-stringifies plain objects', () => {
    expect(errText({ code: 42 })).toBe('{"code":42}');
  });

  it('returns strings as-is', () => {
    expect(errText('plain failure')).toBe('plain failure');
  });
});
