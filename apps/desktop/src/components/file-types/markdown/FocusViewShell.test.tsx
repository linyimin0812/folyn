// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { createElement, useState } from 'react';
import { FocusViewShell } from './FocusViewShell';
import { PreviewActiveContext } from './PreviewActiveContext';

// Host wrapper that mirrors how owners hold the open state (owner keeps
// focused=true; shell calls onClose to flip it).
function Host({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return open
    ? createElement(FocusViewShell, {
        title: 'mermaid · 第 3 行',
        onClose: () => { onClose?.(); setOpen(false); },
        ariaLabel: '专注查看图表',
      }, createElement('p', null, 'body'))
    : null;
}

describe('FocusViewShell', () => {
  afterEach(cleanup);

  it('portals the card to body with the given title', () => {
    render(createElement(Host));
    const overlay = document.body.querySelector('.md-code-focus-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('.md-code-focus-head')?.textContent).toContain('mermaid · 第 3 行');
    expect(overlay?.querySelector('.md-code-focus-body')?.textContent).toContain('body');
    expect(document.querySelector('[aria-label="close focus view"]')).not.toBeNull();
  });

  it('Escape closes (capture wins) and the close button closes', () => {
    const onClose = vi.fn();
    const { unmount } = render(createElement(Host, { onClose }));
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.md-code-focus-overlay')).toBeNull();
    unmount();
    // Reopen and close via the button.
    cleanup();
    render(createElement(Host, { onClose }));
    fireEvent.click(document.querySelector('[aria-label="close focus view"]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.body.querySelector('.md-code-focus-overlay')).toBeNull();
  });

  it('backdrop click closes, card click does not', () => {
    const { container } = render(createElement(Host));
    void container;
    const overlay = document.body.querySelector('.md-code-focus-overlay')!;
    fireEvent.click(overlay.querySelector('.md-code-focus')!);
    expect(document.body.querySelector('.md-code-focus-overlay')).not.toBeNull();
    // Direct click on the overlay element itself (backdrop region).
    fireEvent.click(overlay);
    expect(document.body.querySelector('.md-code-focus-overlay')).toBeNull();
  });

  it('restores keyboard focus to the pre-overlay element on unmount', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    const { unmount } = render(createElement(Host));
    unmount();
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });

  it('renders nothing while the hosting pane is hidden (PreviewActiveContext false)', () => {
    const { rerender } = render(createElement(PreviewActiveContext.Provider, { value: false }, createElement(Host)));
    expect(document.body.querySelector('.md-code-focus-overlay')).toBeNull();
    // Showing the tab again brings the overlay back (state survived).
    rerender(createElement(PreviewActiveContext.Provider, { value: true }, createElement(Host)));
    expect(document.body.querySelector('.md-code-focus-overlay')).not.toBeNull();
  });

  it('wheel outside the body is prevented; wheel on the body is not', () => {
    render(createElement(Host));
    const overlay = document.body.querySelector('.md-code-focus-overlay')!;
    const body = overlay.querySelector('.md-code-focus-body') as HTMLElement;
    // Native non-passive listener — must use native events, not fireEvent.
    const onBackdrop = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    overlay.dispatchEvent(onBackdrop);
    expect(onBackdrop.defaultPrevented).toBe(true);
    const onBody = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    body.dispatchEvent(onBody);
    expect(onBody.defaultPrevented).toBe(false);
  });
});
