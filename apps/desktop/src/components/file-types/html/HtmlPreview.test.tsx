// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { HtmlPreview } from './HtmlPreview';

/**
 * Sandbox hardening tests for `HtmlPreview`.
 *
 * Ceiling note (ponytail): jsdom does NOT enforce iframe `sandbox` origin
 * isolation — `iframe.contentDocument` remains accessible regardless of the
 * `sandbox` attribute, and `srcDoc` inline scripts are not executed by jsdom.
 * So we cannot assert a real privilege-escalation attempt (e.g. a script
 * reading `parent.window.__TAURI__`) would fail at runtime here. The ceiling
 * is therefore string-level + structure-level:
 *   - `sandbox` attribute MUST NOT contain `allow-same-origin`.
 *   - `srcDoc` MUST carry the bootstrap injection (light style + anchor script)
 *     so the parent-DOM logic from the old onLoad is fully migrated into the
 *     document content.
 *   - No onLoad handler accesses `iframe.contentDocument` (the old leak path).
 *
 * Real cross-origin enforcement is provided by the browser at runtime once the
 * `sandbox` attribute drops `allow-same-origin` (opaque origin → parent
 * access throws SecurityError). That contract is owned by the browser, not by
 * this unit suite.
 */

afterEach(() => { cleanup(); });

describe('HtmlPreview sandbox', () => {
  it('#1 iframe sandbox attribute does NOT contain allow-same-origin', () => {
    const { container } = render(<HtmlPreview content="<p>hi</p>" filePath="x.html" vaultRoot="/" />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-same-origin');
    expect(sandbox).toContain('allow-scripts');
  });

  it('#2 srcDoc carries light-theme bootstrap and anchor script', () => {
    const { container } = render(
      <HtmlPreview content="<!DOCTYPE html><html><body><a href='#sec'>x</a></body></html>" filePath="x.html" vaultRoot="/" />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const srcDoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain('color-scheme:light');
    expect(srcDoc).toContain('background:#fff');
    expect(srcDoc).toContain('data-quill-preview="light"');
    expect(srcDoc).toContain('data-quill-preview="anchors"');
    expect(srcDoc).toContain('scrollIntoView');
    // Original user content survives.
    expect(srcDoc).toContain('href="#sec"');
  });

  it('#3 iframe has no onLoad contentDocument access (privilege-escalation surface removed)', () => {
    // ponytail: the old onLoad handler reached into iframe.contentDocument from
    // the parent realm — that is the leak path when same-origin was allowed.
    // The hardened component has no onLoad handler at all.
    const { container } = render(<HtmlPreview content="<p>x</p>" filePath="x.html" vaultRoot="/" />);
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    // React attaches onLoad as a prop, not an attribute; verify absence of both.
    expect(iframe.hasAttribute('onload')).toBe(false);
    expect((iframe as unknown as { onload?: unknown }).onload).toBeNull();
  });
});
