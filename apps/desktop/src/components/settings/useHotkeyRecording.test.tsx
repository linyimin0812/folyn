import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen, cleanup } from '@testing-library/react';
import { useHotkeyRecording } from '@/components/settings/useHotkeyRecording';

/** Minimal harness so `containerRef` actually attaches to the DOM — the
 * click-outside effect reads `containerRef.current.contains(...)`, which is
 * a no-op under `renderHook` (ref never attached). Rendering a real div is
 * the smallest way to exercise the click-outside path. */
function Harness({ onCapture, conflictTimeoutMs }: {
  onCapture: (e: KeyboardEvent) => void;
  conflictTimeoutMs?: number;
}) {
  const { recording, start, containerRef, conflictHint } = useHotkeyRecording(onCapture, { conflictTimeoutMs });
  return (
    <div
      ref={containerRef}
      data-testid="harness"
      data-recording={recording ? '1' : '0'}
      data-conflict={conflictHint ? '1' : '0'}
      onClick={start}
    />
  );
}

function keydown(key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) {
  // Capture-phase listener is registered on `window`; dispatching there
  // reaches it. jsdom's KeyboardEvent supports the modifier flags.
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...mods }));
}

describe('useHotkeyRecording', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  it('enters recording on start and captures a non-modifier combo', () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} conflictTimeoutMs={2500} />);
    const el = screen.getByTestId('harness');

    act(() => fireEvent.click(el));
    expect(el.dataset.recording).toBe('1');

    act(() => keydown('k', { metaKey: true }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    const event = onCapture.mock.calls[0][0] as KeyboardEvent;
    expect(event.key).toBe('k');
    expect(event.metaKey).toBe(true);
    // Recording exits after capture.
    expect(el.dataset.recording).toBe('0');
  });

  it('ignores lone modifier keys (waits for the completing key)', () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} />);
    const el = screen.getByTestId('harness');
    act(() => fireEvent.click(el));

    act(() => keydown('Shift'));
    act(() => keydown('Meta'));
    expect(onCapture).not.toHaveBeenCalled();
    expect(el.dataset.recording).toBe('1'); // still recording
  });

  it('routes Escape through onCapture so the caller decides (voice clears, shortcut rebinds)', () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} />);
    const el = screen.getByTestId('harness');
    act(() => fireEvent.click(el));

    act(() => keydown('Escape'));
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture.mock.calls[0][0].key).toBe('Escape');
    expect(el.dataset.recording).toBe('0');
  });

  it('click-outside cancels recording without committing', () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} />);
    const el = screen.getByTestId('harness');
    act(() => fireEvent.click(el));
    expect(el.dataset.recording).toBe('1');

    // mousedown on document.body (outside the harness div) cancels.
    act(() => fireEvent.mouseDown(document.body));
    expect(el.dataset.recording).toBe('0');
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('flips conflictHint after the timeout when nothing is captured', () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} conflictTimeoutMs={2500} />);
    const el = screen.getByTestId('harness');
    act(() => fireEvent.click(el));
    expect(el.dataset.conflict).toBe('0');

    act(() => { vi.advanceTimersByTime(2500); });
    expect(el.dataset.conflict).toBe('1');

    // A subsequent capture clears the hint and exits recording.
    act(() => keydown('p'));
    expect(el.dataset.conflict).toBe('0');
    expect(el.dataset.recording).toBe('0');
  });

  it('does not arm a conflict timer when conflictTimeoutMs is omitted', () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} />);
    const el = screen.getByTestId('harness');
    act(() => fireEvent.click(el));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(el.dataset.conflict).toBe('0');
  });
});
