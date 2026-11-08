// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => `asset://${p}` }));
vi.mock('@/services/externalFileProvider', () => ({ resolveAbsolutePath: async (p: string) => p }));
vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));

import { VaultImageInner } from './VaultImage';
import { AssetResolverContext } from './assetResolver';

const refs = { contentRef: { current: '' }, onChangeRef: { current: undefined } };
const image = (src: string) => createElement(VaultImageInner, { src, alt: 'a', rest: {}, filePath: 'doc.md', assetBase: '/base', ...refs });

describe('VaultImageInner', () => {
  it('joins a relative reference onto the document directory on disk', async () => {
    const { container } = render(image('diagrams/a.png'));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('asset:///base/diagrams/a.png'));
  });

  it('hands a relative reference to the resolver of a document not on disk', async () => {
    const resolve = vi.fn(async (ref: string) => `blob:${ref}`);
    const { container } = render(createElement(AssetResolverContext.Provider, { value: resolve }, image('diagrams/整体架构.excalidraw.png')));
    // Nothing loads from the unresolved reference.
    expect(container.querySelector('img')?.getAttribute('src')).toBeNull();
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:diagrams/整体架构.excalidraw.png'));
    expect(resolve).toHaveBeenCalledWith('diagrams/整体架构.excalidraw.png');
  });

  it('leaves http references alone even under a resolver', async () => {
    const resolve = vi.fn();
    const { container } = render(createElement(AssetResolverContext.Provider, { value: resolve }, image('https://x.test/a.png')));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x.test/a.png');
    expect(resolve).not.toHaveBeenCalled();
  });
});
