/**
 * Tests for the icons capability: file-tree icons rendered as markup.
 */

import { describe, it, expect, vi } from 'vitest';

// `FileIcon` reaches the file-type registry, whose built-in handlers call back
// into `FileIcon` at module load. That cycle resolves in the app's load order
// but not under vitest, and this capability tests the render, not the registry.
vi.mock('@/components/file-types/registry', () => ({
  getHandlerById: () => undefined,
  getHandlerByExtension: () => undefined,
}));

import { buildExtensionIcons } from './iconsCapability';

describe('buildExtensionIcons', () => {
  it('renders the same markdown icon the vault tree uses', async () => {
    const { svg } = await buildExtensionIcons().render('说明.md');
    expect(svg).toMatch(/^<(svg|img)/);
    expect(svg).toContain('16');
  });

  it('renders the folder icon for a directory', async () => {
    const file = await buildExtensionIcons().render('');
    const dir = await buildExtensionIcons().render('', { isDir: true });
    expect(dir.svg).not.toBe(file.svg);
  });
});
