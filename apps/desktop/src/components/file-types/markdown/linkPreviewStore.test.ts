// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLinkPreviewStore, __resetLinkPreviewTimers, HOVER_INTENT_MS, LINK_LEAVE_GRACE_MS } from './linkPreviewStore';

describe('linkPreviewStore (hover intent)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetLinkPreviewTimers();
    useLinkPreviewStore.setState({ open: false, target: null, anchorRect: null, token: 0 });
  });
  afterEach(() => {
    __resetLinkPreviewTimers();
    vi.useRealTimers();
  });

  const rect = { left: 10, right: 90, top: 10, bottom: 30 };

  it('opens only after the hover intent delay', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    expect(useLinkPreviewStore.getState().open).toBe(false);
    vi.advanceTimersByTime(HOVER_INTENT_MS - 1);
    expect(useLinkPreviewStore.getState().open).toBe(false);
    vi.advanceTimersByTime(1);
    expect(useLinkPreviewStore.getState().open).toBe(true);
    expect(useLinkPreviewStore.getState().target?.path).toBe('a.md');
  });

  it('leaving before the delay cancels the intent (no flash on pass-through)', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS - 10);
    s.endHover();
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    expect(useLinkPreviewStore.getState().open).toBe(false);
  });

  it('leaving after open schedules a close with a grace window', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    s.endHover();
    vi.advanceTimersByTime(LINK_LEAVE_GRACE_MS - 1);
    expect(useLinkPreviewStore.getState().open).toBe(true);
    vi.advanceTimersByTime(1);
    expect(useLinkPreviewStore.getState().open).toBe(false);
  });

  it('moving onto the popover within the grace holds it open', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    s.endHover();
    vi.advanceTimersByTime(LINK_LEAVE_GRACE_MS / 2);
    s.holdPopover();
    vi.advanceTimersByTime(LINK_LEAVE_GRACE_MS * 4);
    expect(useLinkPreviewStore.getState().open).toBe(true);
    s.releasePopover();
    expect(useLinkPreviewStore.getState().open).toBe(false);
  });

  it('a newer hover supersedes a pending one (stale timer discarded)', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS / 2);
    s.beginHover({ path: 'b.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS / 2);
    // the FIRST timer fired by now — must have been discarded by token check
    expect(useLinkPreviewStore.getState().open).toBe(false);
    vi.advanceTimersByTime(HOVER_INTENT_MS / 2);
    expect(useLinkPreviewStore.getState().open).toBe(true);
    expect(useLinkPreviewStore.getState().target?.path).toBe('b.md');
  });

  it('re-hovering the link the open popover shows does not flicker it', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    const tokenAtOpen = useLinkPreviewStore.getState().token;
    s.endHover();
    vi.advanceTimersByTime(LINK_LEAVE_GRACE_MS / 2);
    s.beginHover({ path: 'a.md' }, rect);
    // same target: stays open, token bumped, no re-open flash
    expect(useLinkPreviewStore.getState().open).toBe(true);
    expect(useLinkPreviewStore.getState().token).toBeGreaterThan(tokenAtOpen);
  });

  it('hovering a different link while open re-targets after the full delay', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    s.beginHover({ path: 'b.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS - 1);
    // old popover for a.md is still showing (target already updated for the
    // next open — but open stays with the old content until re-fire)
    expect(useLinkPreviewStore.getState().target?.path).toBe('b.md');
    vi.advanceTimersByTime(1);
    expect(useLinkPreviewStore.getState().open).toBe(true);
  });

  it('close clears everything immediately', () => {
    const s = useLinkPreviewStore.getState();
    s.beginHover({ path: 'a.md' }, rect);
    vi.advanceTimersByTime(HOVER_INTENT_MS);
    s.close();
    expect(useLinkPreviewStore.getState().open).toBe(false);
    expect(useLinkPreviewStore.getState().target).toBeNull();
    // pending timers from an earlier endHover must not re-open it
    s.endHover();
    vi.advanceTimersByTime(HOVER_INTENT_MS * 2);
    expect(useLinkPreviewStore.getState().open).toBe(false);
  });
});
