import { describe, it, expect } from 'vitest';
import { resolveManifestIcon, pickCatalogText } from './extensionStore';

describe('resolveManifestIcon', () => {
  it('prefers the top-level manifest icon', () => {
    expect(
      resolveManifestIcon({
        icon: '🚀',
        contributes: { features: [{ icon: '<svg></svg>' }] },
      }),
    ).toBe('🚀');
  });

  it('falls back to the first contribution icon (features first)', () => {
    expect(
      resolveManifestIcon({
        contributes: {
          commands: [{ icon: '📝' }],
          features: [{ icon: '<svg width="16" height="16"></svg>' }],
        },
      }),
    ).toBe('<svg width="16" height="16"></svg>');
  });

  it('walks the priority order features → tools → containers → commands → fileTemplates', () => {
    expect(
      resolveManifestIcon({
        contributes: { tools: [{ icon: '🛠' }], commands: [{ icon: '📝' }] },
      }),
    ).toBe('🛠');
    expect(
      resolveManifestIcon({
        contributes: { containers: [{ icon: '✅' }], commands: [{ icon: '📝' }] },
      }),
    ).toBe('✅');
    expect(
      resolveManifestIcon({
        contributes: { fileTemplates: [{ icon: '🗂' }], commands: [{ icon: '📝' }] },
      }),
    ).toBe('📝');
  });

  it('skips empty icons and keeps scanning', () => {
    expect(
      resolveManifestIcon({
        contributes: {
          features: [{ icon: '   ' }, { icon: '' }],
          containers: [{ icon: '💡' }],
        },
      }),
    ).toBe('💡');
  });

  it('returns undefined when no icon is declared anywhere', () => {
    expect(resolveManifestIcon({})).toBeUndefined();
    expect(resolveManifestIcon({ contributes: { commands: [{ icon: '' }] } })).toBeUndefined();
  });
});

describe('pickCatalogText', () => {
  it('returns the plain string as-is (single-locale fallback)', () => {
    expect(pickCatalogText('DBML', 'en')).toBe('DBML');
    expect(pickCatalogText('DBML', 'ja')).toBe('DBML');
  });

  it('returns the exact locale when present', () => {
    expect(pickCatalogText({ zh: '富文本', en: 'Rich Text' }, 'zh')).toBe('富文本');
    expect(pickCatalogText({ zh: '富文本', en: 'Rich Text' }, 'en')).toBe('Rich Text');
  });

  it('falls back to zh (app fallbackLng) when the locale is missing', () => {
    expect(pickCatalogText({ zh: '富文本', en: 'Rich Text' }, 'ja')).toBe('富文本');
  });

  it('falls back to en when neither locale nor zh is present', () => {
    expect(pickCatalogText({ en: 'Rich Text' }, 'ja')).toBe('Rich Text');
    expect(pickCatalogText({ en: 'Rich Text' }, 'zh')).toBe('Rich Text');
  });

  it('falls back to the first available when only an unrelated locale is given', () => {
    expect(pickCatalogText({ es: 'Visor de archivos' }, 'de')).toBe('Visor de archivos');
  });

  it('returns undefined for nullish input', () => {
    expect(pickCatalogText(undefined, 'en')).toBeUndefined();
  });
});
