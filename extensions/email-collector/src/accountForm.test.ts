import { describe, it, expect } from 'vitest';
import { authHelpUrl, showsServerFields } from './accountForm';

describe('authHelpUrl', () => {
  it('finds the provider page by mail domain, case-insensitively', () => {
    expect(authHelpUrl('me@gmail.com')).toBe('https://support.google.com/mail/answer/185833');
    expect(authHelpUrl('me@QQ.com')).toBe('https://service.mail.qq.com/detail/0/75');
  });

  it('is null for an unknown domain, an address without one, and junk', () => {
    expect(authHelpUrl('me@example.com')).toBeNull();
    expect(authHelpUrl('me')).toBeNull();
    expect(authHelpUrl(undefined)).toBeNull();
  });
});

describe('showsServerFields', () => {
  it('hides the server field for a provider whose host is inferred', () => {
    expect(showsServerFields({ username: 'me@gmail.com', host: '' })).toBe(false);
    expect(showsServerFields({ username: 'me@163.com' })).toBe(false);
  });

  it('shows them for an unknown provider and for an address still being typed', () => {
    expect(showsServerFields({ username: 'me@example.com' })).toBe(true);
    expect(showsServerFields({ username: '' })).toBe(true);
  });

  it('keeps a host the user already filled in visible, even for a known provider', () => {
    expect(showsServerFields({ username: 'me@gmail.com', host: 'imap.corp.example' })).toBe(true);
  });
});
