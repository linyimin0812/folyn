import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import MindMapCanvas from './MindMapCanvas';
import type { PreviewProps } from '../types';

afterEach(() => { cleanup(); });
beforeEach(() => { cleanup(); });

// ponytail: regression test for the "画布" trigger button. The button is a
// SIBLING of the mind-elixir mount target (elRef), not a descendant — so
// mind-elixir's own pointer/click listeners never see clicks on the button.
// An earlier version had `onClickCapture={(e) => e.stopPropagation()}` on
// the button, which stopped the native click at the target in the capture
// phase; since React 18 attaches onClick via a root-level bubble delegate,
// the event never bubbled back to the root and onClick never fired — the
// panel never opened. This test pins the fix: a click toggles the panel.
afterEach(() => { cleanup(); });

const props: PreviewProps = {
  content: '- Root\n  - Child A\n  - Child B',
  filePath: '/tmp/test.mmap',
  vaultRoot: '/tmp',
};

describe('MindMapCanvas 画布 trigger button', () => {
  it('click opens the canvas style panel; a second click closes it', async () => {
    // Suppress mind-elixir's jsdom noise (getScreenCTM / createSVGMatrix are
    // not implemented) — the button click works regardless of whether the
    // canvas fully initializes, because the button is React-rendered.
    const origError = console.error;
    console.error = (...a: unknown[]) => {
      const s = String(a[0] ?? '');
      if (
        s.includes('createSVGMatrix') ||
        s.includes('getScreenCTM') ||
        s.includes('getBBox') ||
        s.includes('NotImplementedError')
      ) return;
      origError.apply(console, a as never);
    };
    try {
      const { container } = render(<MindMapCanvas {...props} />);
      // Let mind-elixir's async init resolve.
      await waitFor(() => {
        expect(container.querySelector('.map-container')).not.toBeNull();
      });

      const btn = screen.getByTitle('画布样式') as HTMLButtonElement;
      // No <select> (CanvasStylePanel) before clicking.
      expect(container.querySelector('select')).toBeNull();

      // First click → panel appears (CanvasStylePanel renders <select> controls).
      fireEvent.click(btn);
      await waitFor(() => {
        expect(container.querySelector('select')).not.toBeNull();
      });

      // Second click → panel disappears.
      fireEvent.click(btn);
      await waitFor(() => {
        expect(container.querySelector('select')).toBeNull();
      });
    } finally {
      console.error = origError;
    }
  });
});
