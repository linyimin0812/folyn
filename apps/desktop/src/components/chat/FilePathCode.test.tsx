import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FilePathContext, CodeOverride } from './FilePathCode';
import { clearPathExistsCache } from './filePath';

afterEach(() => {
  cleanup();
});

function renderWithCtx(node: React.ReactNode, ctx: React.ContextType<typeof FilePathContext>) {
  return render(
    <FilePathContext.Provider value={ctx}>{node}</FilePathContext.Provider>,
  );
}

describe('CodeOverride (inline code path detection)', () => {
  beforeEach(() => {
    clearPathExistsCache();
  });

  it('renders plain <code> for non-path inline code', () => {
    renderWithCtx(
      <CodeOverride>someFunction</CodeOverride>,
      { onPathClick: () => {}, resolvePath: async () => true },
    );
    const el = screen.getByText('someFunction');
    expect(el.tagName).toBe('CODE');
    expect(el.getAttribute('title')).toBeNull();
  });

  it('renders plain <code> for fenced block code (has language- class)', () => {
    renderWithCtx(
      <CodeOverride className="hljs language-ts">const x = 1;</CodeOverride>,
      { onPathClick: () => {}, resolvePath: async () => true },
    );
    const el = screen.getByText('const x = 1;');
    expect(el.tagName).toBe('CODE');
    expect(el.getAttribute('title')).toBeNull();
  });

  it('renders plain <code> when no callbacks are wired (pet chat path)', () => {
    renderWithCtx(<CodeOverride>apps/foo.ts</CodeOverride>, {});
    const el = screen.getByText('apps/foo.ts');
    expect(el.tagName).toBe('CODE');
    expect(el.getAttribute('title')).toBeNull();
    expect(el.style.cursor).toBe('');
  });

  it('renders clickable when resolvePath returns true', async () => {
    const onClick = vi.fn();
    const resolve = vi.fn().mockResolvedValue(true);
    renderWithCtx(
      <CodeOverride>apps/foo.ts:12:4</CodeOverride>,
      { onPathClick: onClick, resolvePath: resolve },
    );
    await waitFor(() => {
      const el = screen.getByText('apps/foo.ts:12:4');
      expect(el.style.cursor).toBe('pointer');
    });
    const el = screen.getByText('apps/foo.ts:12:4');
    expect(el.getAttribute('title')).toBe('apps/foo.ts:12:4');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledWith('apps/foo.ts', 12, 4);
  });

  it('stays plain when resolvePath returns false', async () => {
    const onClick = vi.fn();
    const resolve = vi.fn().mockResolvedValue(false);
    renderWithCtx(
      <CodeOverride>apps/foo.ts</CodeOverride>,
      { onPathClick: onClick, resolvePath: resolve },
    );
    await waitFor(() => expect(resolve).toHaveBeenCalled());
    const el = screen.getByText('apps/foo.ts');
    expect(el.style.cursor).toBe('');
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });
});
