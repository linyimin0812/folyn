/**
 * Slice 6 link-scheme verification: evidence asset links in capture notes
 * are NOTE-RELATIVE (`./<base>.evidence/assets/…`). VaultImage resolves a
 * relative src against `assetBase` (the document's directory), so re-rooting
 * the vault — moving it on disk and reopening the note — re-resolves the
 * SAME link against the new root. Nothing in the note needs rewriting.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createElement, createRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
// The .excalidraw branch of VaultImage is irrelevant here — stub the heavy
// import so jsdom doesn't load the excalidraw bundle.
vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));
import { VaultImageInner } from './VaultImage';

function renderImage(assetBase: string) {
  const contentRef = createRef<string>();
  contentRef.current = '';
  const onChangeRef = createRef<((c: string) => void) | undefined>();
  return render(createElement(VaultImageInner as React.ComponentType<Record<string, unknown>>, {
    src: './capture.evidence/assets/0001.png',
    alt: 'attachment image',
    rest: {},
    filePath: 'notes/capture.md',
    assetBase,
    contentRef,
    onChangeRef,
  }));
}

describe('VaultImage evidence-asset links survive a vault move', () => {
  it('a relative evidence link resolves against the document directory, whichever root it hangs from', async () => {
    const { container, rerender, unmount } = renderImage('/vault-a/notes');
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        convertFileSrc('/vault-a/notes/capture.evidence/assets/0001.png'),
      ),
    );

    // the vault moved on disk; the SAME relative link now resolves under the
    // new root — resolution is always assetBase-joined, never cached per root
    rerender(createElement(VaultImageInner as React.ComponentType<Record<string, unknown>>, {
      src: './capture.evidence/assets/0001.png',
      alt: 'attachment image',
      rest: {},
      filePath: 'notes/capture.md',
      assetBase: '/moved-vault/notes',
      contentRef: { current: '' },
      onChangeRef: { current: undefined },
    }));
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        convertFileSrc('/moved-vault/notes/capture.evidence/assets/0001.png'),
      ),
    );
    unmount();
  });
});
