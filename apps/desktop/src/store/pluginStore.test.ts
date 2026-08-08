import { describe, it, expect } from 'vitest';
import { resolveManifestIcon } from './pluginStore';

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
