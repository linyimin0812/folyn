// ponytail: Tauri 2's webview does not handle `<a download href="blob:...">` clicks
// (no save dialog, no file written), and `navigator.clipboard.write` for images is
// unreliable in WKWebView. These two installers patch the DOM-level behaviors that
// libraries like Excalidraw use for "Save to disk" / "Copy to clipboard". Each returns
// a cleanup that fully reverts the patch — caller owns the lifecycle (typically a
// useEffect on editor mount/unmount). The patches are global for their installed
// lifetime; stacking across multiple simultaneous editors works via stack-restore
// (last unmount wins).

// ponytail: Excalidraw's save path (via `browser-fs-access`'s legacy fallback)
// creates an orphan `<a download href="blob:...">` and calls `.click()` on it
// programmatically — without attaching it to the DOM. A document-level click
// listener never fires because the orphan isn't in the DOM tree. Patching
// HTMLAnchorElement.prototype.click catches both orphan and attached anchors
// and routes `blob:`-href downloads through Tauri's save dialog.

export function installAnchorDownloadInterceptor(): () => void {
  const proto = HTMLAnchorElement.prototype;
  const origClick = proto.click;
  const patched = function (this: HTMLAnchorElement) {
    const href = this.getAttribute('href') || '';
    if (this.hasAttribute('download') && href.startsWith('blob:')) {
      void handleBlobDownload(this);
      return;
    }
    return origClick.call(this);
  };
  Object.defineProperty(proto, 'click', {
    value: patched,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(proto, 'click', {
      value: origClick,
      configurable: true,
      writable: true,
    });
  };
}

async function handleBlobDownload(anchor: HTMLAnchorElement): Promise<void> {
  const downloadName = anchor.getAttribute('download') || 'export';
  try {
    const res = await fetch(anchor.href);
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: downloadName });
    if (!path) return;
    await writeFile(path, bytes);
  } catch (err) {
    console.error('[tauriBrowserShim] anchor download intercept failed:', err);
  }
}

export function installClipboardImageWritePatch(): () => void {
  const proto = Clipboard.prototype;
  const origWrite = proto.write;

  const patched = async function (this: Clipboard, items: ClipboardItems) {
    for (const item of items) {
      const imgType = item.types.find((t) => t === 'image/png' || t === 'image/svg+xml');
      if (!imgType) continue;
      try {
        await writeImageToTauri(item, imgType);
        return;
      } catch (err) {
        console.warn('[tauriBrowserShim] Tauri image clipboard failed, falling back:', err);
      }
    }
    return origWrite.call(this, items);
  };

  Object.defineProperty(proto, 'write', { value: patched, configurable: true });
  return () => {
    Object.defineProperty(proto, 'write', { value: origWrite, configurable: true });
  };
}

async function writeImageToTauri(item: ClipboardItem, type: string): Promise<void> {
  const blob = await item.getType(type);
  if (type === 'image/svg+xml') {
    const text = await blob.text();
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
    return;
  }
  const rgba = await pngBlobToRgba(blob);
  const { Image } = await import('@tauri-apps/api/image');
  const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
  const img = await Image.new(rgba.data, rgba.width, rgba.height);
  await writeImage(img);
}

async function pngBlobToRgba(
  blob: Blob,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('failed to load PNG'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(data.buffer), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
