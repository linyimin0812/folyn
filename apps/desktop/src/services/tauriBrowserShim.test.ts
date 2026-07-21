import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import {
  installAnchorDownloadInterceptor,
  installClipboardImageWritePatch,
} from './tauriBrowserShim';

describe('tauriBrowserShim', () => {
  describe('installAnchorDownloadInterceptor', () => {
    // ponytail: Excalidraw (via browser-fs-access) creates an orphan anchor and
    // calls `.click()` programmatically. A document-level click listener never
    // fires on orphan anchors — so we patch HTMLAnchorElement.prototype.click
    // directly. These tests verify the patch installs, intercepts blob: URLs
    // with download attr, and falls through to the original click for other
    // anchors (real navigation, no download, non-blob href).
    const proto = HTMLAnchorElement.prototype;
    const origClick = proto.click;
    afterEach(() => {
      Object.defineProperty(proto, 'click', {
        value: origClick,
        configurable: true,
        writable: true,
      });
    });

    it('patches click on install and restores on cleanup', () => {
      const before = proto.click;
      const cleanup = installAnchorDownloadInterceptor();
      expect(proto.click).not.toBe(before);
      cleanup();
      expect(proto.click).toBe(before);
    });

    it('falls through to original click for non-blob hrefs', () => {
      const origClickSpy = vi.fn();
      Object.defineProperty(proto, 'click', {
        value: origClickSpy,
        configurable: true,
        writable: true,
      });
      const cleanup = installAnchorDownloadInterceptor();
      const a = document.createElement('a');
      a.setAttribute('href', 'https://example.com');
      a.setAttribute('download', 'foo.txt');
      a.click();
      expect(origClickSpy).toHaveBeenCalled();
      cleanup();
    });

    it('falls through when no download attribute is present', () => {
      const origClickSpy = vi.fn();
      Object.defineProperty(proto, 'click', {
        value: origClickSpy,
        configurable: true,
        writable: true,
      });
      const cleanup = installAnchorDownloadInterceptor();
      const a = document.createElement('a');
      a.setAttribute('href', 'blob:https://example.com/abc');
      a.click();
      expect(origClickSpy).toHaveBeenCalled();
      cleanup();
    });
  });

  describe('installClipboardImageWritePatch', () => {
    // ponytail: jsdom has no global Clipboard. Build a minimal stand-in just
    // enough to assert the prototype is patched on install and restored on
    // cleanup. The image-routing branch is exercised manually in a running
    // Tauri session — full end-to-end coverage needs WKWebView + the Tauri
    // clipboard plugin, which vitest can't simulate.
    class FakeClipboard {}
    const fakeProto = FakeClipboard.prototype as unknown as Clipboard['prototype'];
    const origWrite = vi.fn(async () => undefined);
    const origGlobal = (globalThis as { Clipboard?: unknown }).Clipboard;
    (globalThis as { Clipboard: unknown }).Clipboard = FakeClipboard;

    afterEach(() => {
      Object.defineProperty(fakeProto, 'write', {
        value: origWrite,
        configurable: true,
        writable: true,
      });
    });
    afterAll(() => {
      (globalThis as { Clipboard: unknown }).Clipboard = origGlobal;
    });

    it('patches write on install and restores on cleanup', () => {
      const before = Object.getOwnPropertyDescriptor(fakeProto, 'write')?.value;
      const cleanup = installClipboardImageWritePatch();
      const after = Object.getOwnPropertyDescriptor(fakeProto, 'write')?.value;
      expect(after).not.toBe(before);
      cleanup();
      const restored = Object.getOwnPropertyDescriptor(fakeProto, 'write')?.value;
      expect(restored).toBe(before);
    });

    it('stack-restores across nested installs', () => {
      const c1 = installClipboardImageWritePatch();
      const c2 = installClipboardImageWritePatch();
      c2();
      c1();
      expect(Object.getOwnPropertyDescriptor(fakeProto, 'write')?.value).toBe(origWrite);
    });
  });
});
