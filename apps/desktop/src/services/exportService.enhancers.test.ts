/**
 * Focused unit test for `applyContainerEnhancers` — the export DOM walk that
 * applies plugin-contributed export enhancers to `[data-container]` blocks.
 *
 * `renderMarkdownToHtmlViaDom` is not driven here (it mounts MarkdownPreview
 * which pulls excalidraw + x6 — jsdom ceiling, see file-type-editors.md spec).
 * Instead we test the extracted pure walk in isolation: build a DOM with
 * `[data-container]` blocks, mock the registry, assert the enhancer is
 * applied to the right body element and action buttons are stripped.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyContainerEnhancers } from './exportService';

// Mock the registry so we control which enhancer is returned for which key.
vi.mock('./plugin-host/exportEnhancerAdapter', () => ({
  getEnhancer: vi.fn(),
}));

import { getEnhancer } from './plugin-host/exportEnhancerAdapter';
const getEnhancerMock = vi.mocked(getEnhancer);

beforeEach(() => {
  getEnhancerMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyContainerEnhancers', () => {
  it('applies a matching enhancer to the [data-container] block', async () => {
    const enhancer = vi.fn(async () => {});
    getEnhancerMock.mockImplementation((key: string) =>
      key === 'quote' ? enhancer : undefined,
    );

    const root = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-container', 'quote');
    block.textContent = 'hello';
    root.appendChild(block);

    await applyContainerEnhancers(root, { filePath: 'note.md', vaultRoot: '/vault' });

    expect(enhancer).toHaveBeenCalledTimes(1);
    const [body, ctx] = enhancer.mock.calls[0];
    expect(body).toBe(block); // no inner [data-file-preview-body] → block itself
    expect(ctx).toEqual({ filePath: 'note.md', vaultRoot: '/vault' });
  });

  it('uses the inner [data-file-preview-body] when present', async () => {
    const enhancer = vi.fn(async () => {});
    getEnhancerMock.mockImplementation(() => enhancer);

    const root = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-container', 'canvas');
    const innerBody = document.createElement('div');
    innerBody.setAttribute('data-file-preview-body', '');
    innerBody.textContent = 'svg here';
    block.appendChild(innerBody);
    root.appendChild(block);

    await applyContainerEnhancers(root, { filePath: 'x.md', vaultRoot: '/v' });

    expect(enhancer).toHaveBeenCalledTimes(1);
    expect(enhancer.mock.calls[0][0]).toBe(innerBody);
  });

  it('strips action buttons before invoking the enhancer', async () => {
    const enhancer = vi.fn(async () => {});
    getEnhancerMock.mockImplementation(() => enhancer);

    const root = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-container', 'quote');
    const btn = document.createElement('button');
    btn.textContent = 'Edit';
    block.appendChild(btn);
    root.appendChild(block);

    await applyContainerEnhancers(root, { filePath: '', vaultRoot: '' });

    expect(block.querySelector('button')).toBeNull();
    expect(enhancer).toHaveBeenCalled();
  });

  it('skips blocks with no matching enhancer (no throw)', async () => {
    getEnhancerMock.mockImplementation(() => undefined);
    const root = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-container', 'unknown');
    root.appendChild(block);
    await expect(
      applyContainerEnhancers(root, { filePath: '', vaultRoot: '' }),
    ).resolves.toBeUndefined();
  });

  it('swallows enhancer failures (best-effort)', async () => {
    getEnhancerMock.mockImplementation(() => async () => {
      throw new Error('boom');
    });
    const root = document.createElement('div');
    const block = document.createElement('div');
    block.setAttribute('data-container', 'quote');
    root.appendChild(block);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      applyContainerEnhancers(root, { filePath: '', vaultRoot: '' }),
    ).resolves.toBeUndefined();
    errSpy.mockRestore();
  });
});
