// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { FORWARDED_KEY_MESSAGE, isShortcutCandidate, listenForForwardedKeys, readForwardedKey } from './iframeShortcuts';

const msg = (fields: Record<string, unknown>) => ({ type: FORWARDED_KEY_MESSAGE, key: 'Enter', metaKey: true, shiftKey: true, ...fields });

describe('isShortcutCandidate', () => {
  it('takes Esc, function keys and ⌘/Ctrl combinations', () => {
    expect(isShortcutCandidate({ key: 'Escape', metaKey: false, ctrlKey: false })).toBe(true);
    expect(isShortcutCandidate({ key: 'F5', metaKey: false, ctrlKey: false })).toBe(true);
    expect(isShortcutCandidate({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isShortcutCandidate({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true);
  });
  it('ignores plain typing', () => {
    for (const key of ['a', 'Enter', 'Tab', ' ', 'F']) expect(isShortcutCandidate({ key, metaKey: false, ctrlKey: false })).toBe(false);
  });
});

describe('readForwardedKey', () => {
  it('reads a well-formed message', () => {
    expect(readForwardedKey(msg({ code: 'Enter' }))).toEqual({ key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true });
  });
  it('rejects other messages, non-candidates and junk', () => {
    expect(readForwardedKey({ type: 'folyn:open-dropped-files' })).toBeNull();
    expect(readForwardedKey(msg({ key: 'a', metaKey: false }))).toBeNull();
    expect(readForwardedKey(msg({ key: 42 }))).toBeNull();
    expect(readForwardedKey(msg({ key: 'x'.repeat(50) }))).toBeNull();
    expect(readForwardedKey(null)).toBeNull();
    // Only literal `true` counts as a pressed modifier.
    expect(readForwardedKey(msg({ metaKey: 'yes', key: 'Escape' }))?.metaKey).toBe(false);
  });
});

describe('listenForForwardedKeys', () => {
  let stop: (() => void) | undefined;
  afterEach(() => { stop?.(); document.body.innerHTML = ''; });

  const frame = () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    return iframe.contentWindow!;
  };
  const seen = () => {
    const keys: string[] = [];
    document.addEventListener('keydown', (e) => keys.push(`${e.metaKey ? '⌘' : ''}${e.shiftKey ? '⇧' : ''}${e.key}`));
    return keys;
  };

  it('replays a key posted by a child iframe as a keydown on the document', () => {
    const child = frame();
    stop = listenForForwardedKeys();
    const keys = seen();
    window.dispatchEvent(new MessageEvent('message', { data: msg({}), source: child }));
    expect(keys).toEqual(['⌘⇧Enter']);
  });

  it('ignores messages that do not come from a child iframe', () => {
    frame();
    stop = listenForForwardedKeys();
    const keys = seen();
    window.dispatchEvent(new MessageEvent('message', { data: msg({}), source: window }));
    window.dispatchEvent(new MessageEvent('message', { data: msg({}) }));
    expect(keys).toEqual([]);
  });

  it('stops after cleanup', () => {
    const child = frame();
    stop = listenForForwardedKeys();
    stop();
    stop = undefined;
    const keys = seen();
    window.dispatchEvent(new MessageEvent('message', { data: msg({}), source: child }));
    expect(keys).toEqual([]);
  });
});
