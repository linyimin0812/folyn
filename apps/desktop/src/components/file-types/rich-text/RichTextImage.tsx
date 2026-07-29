import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Image as ImageIcon } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useVaultStore } from '@/store/vaultStore';
import { useVaultConfigStore } from '@/store/vaultConfigStore';
import { resolveBasePath } from '@/utils/pathResolver';
import { isTauri } from '@/utils/platform';
import { resolveVaultRelativePath, isLoadableUrlScheme, nextResizeWidth } from './richTextContent';

// ponytail: image vault-asset persistence. The disk format stores a
// vault-relative `src` (e.g. `assets/images/<sha1>.png`) so the doc is portable
// across vault-root moves; the NodeView resolves it to a loadable `asset://`
// URL at render via the SAME mechanism MarkdownPreview uses
// (`convertFileSrc(<resolvedVaultRoot>/<src>)`). Paste/drop of image FILES
// writes the original bytes to the vault (hash-named for dedup); paste/drop of
// an image URL stores the URL verbatim (no vault write). The file-picker path
// (RichTextToolbar) and the paste/drop path share `persistImageBytes` below.
//
// Why @tauri-apps/plugin-fs direct writes (not vaultStore.manager.writeFileBytes):
// LocalFileStrategy in utils/imageUploader.ts — the established image-upload
// path — writes via plugin-fs `writeFile` + `mkdir({recursive})` against an
// absolute resolved path, bypassing the vault provider. Mirroring that keeps
// one image-write mechanism in the codebase; the vault provider's
// writeFileBytes is provider-abstracted for copy-to-vault flows, not asset
// drops. The file tree refreshes via the existing fs watcher.

const IMAGE_URL_REGEX =
  /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?\S*)?$/i;

/** Derive a lowercase extension (without dot) from a File's mime / name. */
export function extFromImageFile(file: { type: string; name: string }): string {
  const t = file.type.toLowerCase();
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
  };
  if (map[t]) return map[t];
  const m = file.name.toLowerCase().match(/\.([^.]+)$/);
  return m ? m[1] : 'png';
}

/** SHA-1 hex of bytes — content-addressed filename so identical images dedupe. */
async function sha1Hex(bytes: Uint8Array): Promise<string> {
  // ponytail: copy into a fresh ArrayBuffer so crypto.subtle.digest accepts it
  // — the TS lib types BufferSource as ArrayBufferView<ArrayBuffer> and
  // Uint8Array<ArrayBufferLike> (SharedArrayBuffer-bearing) doesn't satisfy.
  // Our sources (File.arrayBuffer / plugin-fs readFile) are real ArrayBuffers;
  // the copy is negligible per image and avoids a type-unsafe cast.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest('SHA-1', ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Write raw image bytes to the vault under the configured `imagePath`
 * (default `assets/images/`), hash-named for dedup. Returns the vault-relative
 * path to store in the Image node's `src`. Tauri-only — callers gate on
 * `isTauri()`; the jsdom test ceiling means this is exercised in-app, not
 * unit-tested (the pure resolution is split into `resolveVaultRelativePath`).
 */
export async function persistImageBytes(
  bytes: Uint8Array,
  ext: string,
): Promise<string> {
  const hash = await sha1Hex(bytes);
  const safeExt = ext.replace(/^\.+/, '').toLowerCase() || 'png';
  const imagePath =
    useVaultConfigStore.getState().imagePath?.replace(/\/+$/, '') || 'assets/images';
  const relPath = `${imagePath}/${hash}.${safeExt}`;
  const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
  const resolvedRoot = await resolveBasePath(vaultRoot);
  const { join } = await import('@tauri-apps/api/path');
  const abs = await join(resolvedRoot, relPath);
  const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
  const parent = abs.substring(0, abs.lastIndexOf('/'));
  if (parent && !(await exists(parent))) await mkdir(parent, { recursive: true });
  await writeFile(abs, bytes);
  return relPath;
}

/** Persist a pasted/dropped File; thin wrapper over persistImageBytes. */
async function persistImageFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return persistImageBytes(bytes, extFromImageFile(file));
}

async function insertImagesAt(
  view: EditorView,
  files: File[],
  pos: number,
): Promise<void> {
  let at = pos;
  for (const f of files) {
    try {
      const relPath = await persistImageFile(f);
      const node = view.state.schema.nodes.image.create({ src: relPath });
      view.dispatch(view.state.tr.insert(at, node));
      at += node.nodeSize;
    } catch (err) {
      console.warn('[rich-text] image persist failed:', err);
    }
  }
  view.focus();
}

const imagePluginKey = new PluginKey('rich-text-image-paste-drop');

function imagePasteDropPlugin(): Plugin {
  return new Plugin({
    key: imagePluginKey,
    props: {
      handlePaste: (view, event) => {
        const cb = event.clipboardData;
        if (!cb) return false;
        const files: File[] = [];
        for (let i = 0; i < cb.items.length; i++) {
          const it = cb.items[i];
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile();
            if (f) files.push(f);
          }
        }
        if (files.length > 0) {
          event.preventDefault();
          const pos = view.state.selection.from;
          void insertImagesAt(view, files, pos);
          return true;
        }
        // ponytail: bare image-URL paste (http…/x.png) inserts an Image node
        // verbatim (no vault write). Heuristic — matches user intent for a
        // clipboard that holds ONLY a link to a raster. Skip if the clipboard
        // carries any non-image file; that's handled above.
        const text = cb.getData('text/plain')?.trim();
        if (text && IMAGE_URL_REGEX.test(text)) {
          const node = view.state.schema.nodes.image.create({ src: text });
          view.dispatch(view.state.tr.replaceSelectionWith(node));
          event.preventDefault();
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        const dt = event.dataTransfer;
        if (!dt) return false;
        const files: File[] = [];
        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files[i];
          if (f.type.startsWith('image/')) files.push(f);
        }
        if (files.length === 0) return false;
        event.preventDefault();
        let pos: number | null = null;
        try {
          pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        } catch {
          pos = null;
        }
        if (pos == null) pos = view.state.selection.from;
        void insertImagesAt(view, files, pos);
        return true;
      },
    },
  });
}

// ponytail: React NodeView is required (not renderHTML) because the src is
// persisted vault-relative but must render as a loadable `asset://` URL, and
// the vault root is resolved asynchronously (`~`/`$HOME` → homeDir). A
// renderHTML closure can't reactively re-resolve on a vault switch; the NodeView
// reads the store reactively and re-renders. This mirrors MarkdownPreview's
// resolvedVaultRoot state, just per-image.

function RichTextImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const src = (node.attrs.src as string) ?? '';
  const alt = (node.attrs.alt as string) ?? '';
  const widthAttr = node.attrs.width as number | null;
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');
  const [resolvedRoot, setResolvedRoot] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!vaultRoot) {
      setResolvedRoot('');
      return;
    }
    resolveBasePath(vaultRoot)
      .then((r) => {
        if (!cancelled) setResolvedRoot(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vaultRoot]);
  const url = useMemo(() => {
    if (!src) return '';
    // ponytail: URL-scheme srcs (http/https/data/asset/tauri/blob) load
    // directly — do NOT feed them to convertFileSrc, which would mangle
    // `https://example.com/x.png` into `asset://localhost/https%3A...`.
    // Mirrors MarkdownPreview's VaultImage short-circuit. Only vault-relative
    // `assets/...` and absolute filesystem paths go through convertFileSrc.
    if (isLoadableUrlScheme(src)) return src;
    // ponytail: gate vault-relative srcs on resolvedRoot — before homeDir()
    // resolves, the NodeView would otherwise fall through to
    // convertFileSrc(rawSrc) and produce an out-of-scope
    // `asset://localhost/<encoded raw src>` URL that 403s. Render the
    // placeholder for the brief async window instead.
    if (!resolvedRoot) return '';
    const abs = resolveVaultRelativePath(src, resolvedRoot);
    if (!abs) return '';
    return isTauri() ? convertFileSrc(abs) : abs;
  }, [src, resolvedRoot]);

  // ponytail: Phase 1 drag-to-resize. Two grips (left/right) on the image,
  // shown on hover or while the node is selected. Dragging sets img.style.width
  // directly (no React state churn mid-drag); on pointer-up the final width is
  // committed to the `width` node attr via updateAttributes, which serializes
  // to disk as part of the tiptap JSON (no manual disk logic). maxWidth caps
  // at naturalWidth so the user can't blur-upscale beyond native resolution.
  // Height stays `auto` so aspect ratio is preserved by the browser.
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStateRef = useRef<{
    side: 'left' | 'right';
    startX: number;
    startWidth: number;
    maxWidth: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, side: 'left' | 'right') => {
      // ponytail: stop propagation + preventDefault so the pointerdown does
      // NOT bubble to the NodeViewWrapper's data-drag-handle → no node-drag.
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      // naturalWidth = 0 before img load; the user can't grip an unloaded
      // image (no rect), so this fallback is defensive only.
      const maxWidth = img.naturalWidth || rect.width || 1;
      dragStateRef.current = { side, startX: e.clientX, startWidth: rect.width, maxWidth };
      setDragging(true);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    const st = dragStateRef.current;
    if (!st) return;
    const next = nextResizeWidth(st.side, st.startWidth, e.clientX - st.startX, st.maxWidth);
    const img = imgRef.current;
    if (img) img.style.width = `${next}px`;
  }, []);

  const onHandlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const st = dragStateRef.current;
      dragStateRef.current = null;
      setDragging(false);
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        // pointerId already released — no-op.
      }
      if (!st) return;
      const img = imgRef.current;
      // Commit the rendered width (what the user actually sees) to the node
      // attr so it persists across reloads. Fall back to startWidth if the img
      // vanished mid-drag (e.g. tab closed).
      const finalWidth = img ? Math.round(img.getBoundingClientRect().width) : st.startWidth;
      updateAttributes({ width: finalWidth });
    },
    [updateAttributes],
  );

  // When an explicit width attr is set, render with inline width + override
  // the global `.ProseMirror img { max-width: 100% }` (RichTextEditor.tsx) so
  // the user-set width wins (and may overflow into horizontal scroll, which is
  // the editor-container's overflow-auto). Without the override, max-w-full
  // would cap to container width and fight the user's resize. Height auto
  // preserves aspect ratio.
  const hasExplicitWidth = widthAttr != null && widthAttr > 0;
  const imgStyle = hasExplicitWidth
    ? { width: widthAttr, height: 'auto' as const, maxWidth: 'none' as const }
    : undefined;
  const imgClassName = hasExplicitWidth
    ? 'h-auto rounded [image-rendering:-webkit-optimize-contrast]'
    : 'max-w-full h-auto rounded [image-rendering:-webkit-optimize-contrast]';
  // Handles render while selected OR mid-drag (so group-hover deactivating
  // during pointer-capture doesn't make the grip vanish mid-resize).
  const showHandles = selected || dragging;

  return (
    <NodeViewWrapper className="block my-2" data-drag-handle>
      {url ? (
        <div className="relative inline-block max-w-full group">
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            loading="lazy"
            // ponytail: WebKit upscale on retina screenshots = bilinear blur.
            // -webkit-optimize-contrast hints higher-quality interpolation.
            // The drag-to-resize path lets the user size to device-pixel parity
            // for the structural fix; this hint stays as a soft fallback for
            // non-resized images. No img-level `selected` ring — the wrapper's
            // global `.ProseMirror-selectednode` ring (RichTextEditor.tsx) is
            // enough; doubling made the highlight feel heavy.
            className={imgClassName}
            style={imgStyle}
          />
          <span
            aria-hidden
            onPointerDown={(e) => onHandlePointerDown(e, 'left')}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            className={`absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 w-1.5 h-10 bg-panel border border-acc rounded-sm cursor-ew-resize shadow-sm transition-opacity ${
              showHandles ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          />
          <span
            aria-hidden
            onPointerDown={(e) => onHandlePointerDown(e, 'right')}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            className={`absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-1.5 h-10 bg-panel border border-acc rounded-sm cursor-ew-resize shadow-sm transition-opacity ${
              showHandles ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          />
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded border border-dashed border-brd text-t3 text-sm">
          <ImageIcon size={14} strokeWidth={1.6} /> image
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * Image extension for the rich-text editor. Extends the official Image node
 * (keeps `setImage` command + markdown `![](src)` paste rule + attributes)
 * and adds: (1) a React NodeView that resolves vault-relative `src` to a
 * loadable `asset://` URL; (2) a paste/drop plugin that writes pasted/dropped
 * image files to the vault and inserts a vault-relative-src Image node.
 */
export const RichTextImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RichTextImageView);
  },
  addProseMirrorPlugins() {
    return [imagePasteDropPlugin()];
  },
});
