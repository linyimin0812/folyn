/**
 * Keyboard shortcuts from inside preview iframes.
 *
 * A key pressed while focus is inside an iframe (the HTML file preview, an
 * ```html code block) is delivered to the iframe's own document and never
 * bubbles to this window, so the app's document-level shortcuts — 专注模式,
 * 演示模式, Esc to leave them — went dead whenever the user had clicked into
 * a preview.
 *
 * The iframes run {@link IFRAME_KEY_FORWARDER}, which posts candidate key
 * presses to the parent. The parent replays them as a synthetic `keydown` on
 * its own document, so `useGlobalShortcuts` handles them with the same rules
 * and the same (rebindable) bindings as any other key press. Nothing is
 * decided inside the iframe, and only plain key fields cross the boundary.
 */

export const FORWARDED_KEY_MESSAGE = 'folyn:shortcut-key';

/** The fields a forwarded key press carries. */
export interface ForwardedKey {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether a key press can be an app shortcut, as opposed to typing that
 * belongs to the page. Esc, function keys, and anything held with ⌘ or Ctrl.
 * Shared by the forwarder (to stay quiet during normal typing) and the
 * receiver (to ignore anything else a page might post).
 */
export function isShortcutCandidate(e: Pick<ForwardedKey, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.key === 'Escape' || /^F\d{1,2}$/.test(e.key) || e.metaKey || e.ctrlKey;
}

/**
 * Script injected into preview iframes. Capture phase, so the page's own
 * handlers cannot swallow the key first. It only posts; it never calls
 * preventDefault, so the page behaves exactly as before.
 */
export const IFRAME_KEY_FORWARDER = `(function(){
  document.addEventListener('keydown', function(e){
    if (!(e.key === 'Escape' || /^F\\d{1,2}$/.test(e.key) || e.metaKey || e.ctrlKey)) return;
    window.parent.postMessage({ type: '${FORWARDED_KEY_MESSAGE}', key: e.key, code: e.code,
      metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey }, '*');
  }, true);
})();`;

/** Validate a posted message and turn it into key fields, or null. */
export function readForwardedKey(data: unknown): ForwardedKey | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== FORWARDED_KEY_MESSAGE || typeof d.key !== 'string' || d.key.length > 20) return null;
  const key: ForwardedKey = {
    key: d.key,
    code: typeof d.code === 'string' ? d.code : '',
    metaKey: d.metaKey === true,
    ctrlKey: d.ctrlKey === true,
    altKey: d.altKey === true,
    shiftKey: d.shiftKey === true,
  };
  return isShortcutCandidate(key) ? key : null;
}

/**
 * Re-dispatch forwarded presses on this document so the global shortcut
 * handler sees them. Only messages from a child frame of this window are
 * accepted. Returns a cleanup function.
 */
export function listenForForwardedKeys(target: Window = window): () => void {
  const onMessage = (e: MessageEvent) => {
    if (e.source === target || !isChildFrame(target, e.source)) return;
    const key = readForwardedKey(e.data);
    if (!key) return;
    target.document.dispatchEvent(new KeyboardEvent('keydown', { ...key, bubbles: true, cancelable: true }));
  };
  target.addEventListener('message', onMessage);
  return () => target.removeEventListener('message', onMessage);
}

/** True when the message came from an iframe directly inside this window. */
function isChildFrame(target: Window, source: MessageEventSource | null): boolean {
  if (!source) return false;
  for (let i = 0; i < target.frames.length; i++) {
    if (target.frames[i] === source) return true;
  }
  return false;
}
