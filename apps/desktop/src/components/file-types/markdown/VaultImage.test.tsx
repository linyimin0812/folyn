// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, cleanup } from '@testing-library/react';
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

  describe('lightbox', () => {
    afterEach(cleanup);
    const lightbox = () => document.body.querySelector('.image-lightbox');

    it('opens the resolved image at 1:1 on click and closes on Escape', async () => {
      const { container } = render(image('diagrams/a.svg'));
      const img = container.querySelector('img')!;
      await waitFor(() => expect(img.getAttribute('src')).toBe('asset:///base/diagrams/a.svg'));
      expect(img.className).toContain('cursor-zoom-in');
      fireEvent.click(img);
      expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe('asset:///base/diagrams/a.svg');
      expect(lightbox()?.textContent).toContain('100%');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(lightbox()).toBeNull();
    });

    it('closes via the close button, not via clicks on the pan canvas', () => {
      const { container } = render(image('https://x.test/a.png'));
      fireEvent.click(container.querySelector('img')!);
      fireEvent.click(lightbox()!.querySelector('.image-viewer-canvas')!);
      expect(lightbox()).not.toBeNull();
      fireEvent.click(lightbox()!.querySelector('button[title="Close"]')!);
      expect(lightbox()).toBeNull();
    });

    it('keeps the caller onClick and does not open inside a link', () => {
      const onClick = vi.fn();
      const el = createElement(VaultImageInner, { src: 'https://x.test/a.png', alt: 'a', rest: { onClick }, filePath: 'doc.md', assetBase: '/base', ...refs });
      const { container } = render(createElement('a', { href: '#x' }, el));
      fireEvent.click(container.querySelector('img')!);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(lightbox()).toBeNull();
    });
  });
});
