import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image, { type ImageOptions } from '@tiptap/extension-image';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
  Image as ImageIcon,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  MessageSquareText,
  Download,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useVaultStore } from '@/store/vaultStore';
import { useVaultConfigStore } from '@/store/vaultConfigStore';
import { resolveBasePath } from '@/utils/pathResolver';
import { isTauri } from '@/utils/platform';
import {
  resolveVaultRelativePath,
  isLoadableUrlScheme,
  nextResizeWidth,
  figureHTML,
  IMAGE_MIN_WIDTH,
  IMAGE_KBD_STEP,
} from './richTextContent';

// ponytail: tiptap's ImageOptions doesn't ship an onImagePaste hook, but the
// extension wires paste/drop through this option. Module augmentation makes
// the option known to addOptions / this.options / configure across the file
// without threading a separate generic through Image.extend (which is the
// heavier pattern the prior fix used and reverted).
declare module '@tiptap/extension-image' {
  interface ImageOptions {
    onImagePaste?: ImagePasteHandler;
  }
}

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
  const { join, dirname } = await import('@tauri-apps/api/path');
  const abs = await join(resolvedRoot, relPath);
  const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
  // ponytail: dirname() is separator-aware. lastIndexOf('/') on a Windows
  // backslash path returns -1 → substring(0, -1) === '' → the mkdir guard is
  // skipped and writeFile fails with "path not found" (os error 3).
  const parent = await dirname(abs);
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

/**
 * Optional host hook for image-file paste/drop. When provided, the plugin
 * hands the pasted/dropped files (and the insert position) to the host
 * instead of persisting directly — lets RichTextEditor open ImagePasteDialog
 * for target/format/size selection, mirroring the markdown editor flow.
 * When absent (HTML export pipeline, tests), the legacy direct-persist path
 * runs so generateHTML still has an image node to serialize.
 */
export type ImagePasteHandler = (files: File[], pos: number) => void;

function imagePasteDropPlugin(onImagePaste?: ImagePasteHandler): Plugin {
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
          if (onImagePaste) onImagePaste(files, pos);
          else void insertImagesAt(view, files, pos);
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
        if (onImagePaste) onImagePaste(files, pos);
        else void insertImagesAt(view, files, pos);
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

// ponytail: Phase 2/3 NodeView. Restructured to <figure> wrapper so the
// floating toolbar, drag grips, img, and figcaption all anchor to one
// positioned container. Alignment via Tailwind margin utilities on the
// figure (mr-auto / mx-auto / ml-auto) — no inline styles, no extra CSS.
// Caption is a contentEditable <figcaption> that commits on blur (one
// transaction = one undo step per caption edit session). A dirtyRef guards
// against React clobbering the textContent mid-edit on incidental parent
// re-renders.
//
// Read-only safety: grips, caption contentEditable, and the mutating toolbar
// buttons (delete/align/caption-toggle) are gated on `editor.isEditable`.
// Download stays available in read-only (doesn't mutate the doc).

type Align = 'left' | 'center' | 'right';

const ALIGN_CLASS: Record<Align, string> = {
  left: 'mr-auto',
  center: 'mx-auto',
  right: 'ml-auto',
};

function RichTextImageView({
  node,
  updateAttributes,
  selected,
  editor,
  deleteNode,
}: NodeViewProps) {
  const src = (node.attrs.src as string) ?? '';
  const alt = (node.attrs.alt as string) ?? '';
  const widthAttr = node.attrs.width as number | null;
  const dataAlign = (node.attrs.dataAlign as Align | null) ?? null;
  const caption = (node.attrs.caption as string | null) ?? null;
  const captionOn = caption != null;
  const editable = !!editor?.isEditable;
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');
  const [resolvedRoot, setResolvedRoot] = useState('');
  const [naturalWidth, setNaturalWidth] = useState(0);
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
    if (isLoadableUrlScheme(src)) return src;
    if (!resolvedRoot) return '';
    const abs = resolveVaultRelativePath(src, resolvedRoot);
    if (!abs) return '';
    return isTauri() ? convertFileSrc(abs) : abs;
  }, [src, resolvedRoot]);

  // --- Phase 1 drag-to-resize (unchanged logic) -------------------------
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
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      // ponytail: cap drag width at min(naturalWidth, containerWidth) so the
      // image can't widen past the editor content area (no horizontal scroll).
      // containerWidth = the .ProseMirror editable's clientWidth (the max-w
      // wrapper in RichTextEditor.tsx constrains it to 760px - padding).
      const containerEl = img.closest('.ProseMirror') as HTMLElement | null;
      const containerWidth = containerEl?.clientWidth ?? rect.width;
      const natural = img.naturalWidth || rect.width || 1;
      const maxWidth = Math.min(natural, containerWidth);
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
    if (!img) return;
    img.style.width = `${next}px`;
    // ponytail: sync figure width to img so the selected-node ring follows
    // the live drag (figure.style.width is otherwise driven by the `width`
    // node attr, which only commits on pointerup — without this, the ring
    // would stay at the pre-drag width until release).
    const fig = img.parentElement;
    if (fig) fig.style.width = `${next}px`;
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
      const finalWidth = img ? Math.round(img.getBoundingClientRect().width) : st.startWidth;
      updateAttributes({ width: finalWidth });
    },
    [updateAttributes],
  );

  // ponytail: grip keyboard resize. Arrow L/R = ∓IMAGE_KBD_STEP (left handle
  // reverses sign so right-arrow always widens visually). Enter/Space/blur
  // commits the rendered width to the node attr (one transaction = one undo
  // step). Falls back to naturalWidth if width attr unset.
  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent, side: 'left' | 'right') => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      if (e.key === 'Enter' || e.key === ' ') {
        const w = Math.round(img.getBoundingClientRect().width);
        updateAttributes({ width: w });
        return;
      }
      const cur = widthAttr ?? (img.getBoundingClientRect().width || naturalWidth || 1);
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const signed = side === 'left' ? -dir : dir;
      const containerEl = img.closest('.ProseMirror') as HTMLElement | null;
      const containerWidth = containerEl?.clientWidth ?? cur;
      const maxW = Math.min(naturalWidth || cur, containerWidth);
      const next = nextResizeWidth(side, cur, signed * IMAGE_KBD_STEP, maxW);
      img.style.width = `${next}px`;
      const fig = img.parentElement;
      if (fig) fig.style.width = `${next}px`;
    },
    [updateAttributes, widthAttr, naturalWidth],
  );

  // --- Phase 2 caption (commit-on-blur) -----------------------------------
  const captionRef = useRef<HTMLElement>(null);
  const dirtyRef = useRef(false);

  const toggleCaption = useCallback(() => {
    if (caption == null) {
      updateAttributes({ caption: '' });
      // focus the figcaption after React mounts it
      requestAnimationFrame(() => {
        captionRef.current?.focus();
      });
    } else {
      updateAttributes({ caption: null });
    }
  }, [caption, updateAttributes]);

  const onCaptionBlur = useCallback(() => {
    const el = captionRef.current;
    if (!el || !dirtyRef.current) return;
    dirtyRef.current = false;
    const text = el.textContent ?? '';
    if (text !== (caption ?? '')) {
      updateAttributes({ caption: text || null });
    }
  }, [caption, updateAttributes]);

  // --- Phase 3 download ---------------------------------------------------
  const downloadImage = useCallback(async () => {
    if (!isTauri() || !src) return;
    // ponytail: URL-scheme download deferred — vault-asset path covers the
    // dominant case. URL srcs (http/data) would need fetch/blob/base64-decode.
    if (isLoadableUrlScheme(src)) return;
    const abs = resolveVaultRelativePath(src, resolvedRoot);
    if (!abs) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
      const ext = src.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? 'png';
      const dest = await save({
        defaultPath: `image-${Date.now()}.${ext}`,
        filters: [{ name: 'Image', extensions: [ext] }],
      });
      if (!dest) return;
      const bytes = new Uint8Array(await readFile(abs));
      await writeFile(dest, bytes);
    } catch (err) {
      console.warn('[rich-text] image download failed:', err);
    }
  }, [src, resolvedRoot]);

  const alignClass = dataAlign ? ALIGN_CLASS[dataAlign] : '';
  const hasExplicitWidth = widthAttr != null && widthAttr > 0;
  // ponytail: img maxWidth 100% caps a user-set width at the editor container
  // (no horizontal scroll). Drag/keyboard resize also caps at min(natural,
  // containerWidth) so the persisted widthAttr never exceeds container; this
  // CSS is the belt-and-suspenders for widthAttrs from older docs / AI writes.
  const imgStyle = hasExplicitWidth
    ? { width: widthAttr, height: 'auto' as const, maxWidth: '100%' as const }
    : undefined;
  const imgClassName = hasExplicitWidth
    ? 'h-auto rounded [image-rendering:-webkit-optimize-contrast]'
    : 'max-w-full h-auto rounded [image-rendering:-webkit-optimize-contrast]';
  // Handles render while selected OR mid-drag (so group-hover deactivating
  // during pointer-capture doesn't make the grip vanish mid-resize).
  const showHandles = editable && (selected || dragging);
  const showToolbar = selected;

  const stopSel = (e: React.SyntheticEvent) => {
    // ponytail: prevent the editor from losing the NodeSelection when a
    // toolbar button is clicked — mousedown default would move the caret.
    e.preventDefault();
    e.stopPropagation();
  };

  const alignBtn = (icon: LucideIcon, title: string, align: Align) => ({
    icon,
    title,
    active: dataAlign === align,
    pressed: dataAlign === align,
    disabled: !editable,
    onClick: () => updateAttributes({ dataAlign: align }),
  });

  const toolbarButtons = [
    { icon: Trash2, title: 'Delete image', disabled: !editable, onClick: () => deleteNode() },
    alignBtn(AlignLeft, 'Align left', 'left'),
    alignBtn(AlignCenter, 'Align center', 'center'),
    alignBtn(AlignRight, 'Align right', 'right'),
    { icon: MessageSquareText, title: 'Toggle caption', active: captionOn, pressed: captionOn, disabled: !editable, onClick: toggleCaption },
    { icon: Download, title: 'Download image', disabled: false, onClick: () => { void downloadImage(); } },
  ];

  const ariaNow = widthAttr ?? (naturalWidth || 1);
  const ariaMax = naturalWidth || ariaNow;

  return (
    <NodeViewWrapper className="block my-2 !ring-0 !shadow-none" data-drag-handle>
      {url ? (
        <figure
          className={`relative block w-fit group select-none ${alignClass} ${selected ? 'ring-2 ring-acc rounded' : ''}`.trim().replace(/\s+/g, ' ')}
          style={hasExplicitWidth ? { width: widthAttr, maxWidth: '100%' } : undefined}
          data-align={dataAlign ?? undefined}
          aria-label={alt || caption || 'Image'}
        >
          {showToolbar && (
            <div
              role="toolbar"
              aria-label="Image actions"
              onMouseDown={stopSel}
              className="absolute -top-9 right-0 z-10 flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-brd bg-panel shadow-md"
            >
              {toolbarButtons.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  title={b.title}
                  aria-label={b.title}
                  aria-pressed={('pressed' in b && b.pressed) ? b.pressed : undefined}
                  disabled={b.disabled}
                  onClick={b.onClick}
                  className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-default ${
                    ('active' in b && b.active) ? 'bg-accdim text-acc' : ''
                  }`}
                >
                  <b.icon size={14} strokeWidth={1.6} />
                </button>
              ))}
            </div>
          )}
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            loading="lazy"
            onLoad={(e) => setNaturalWidth((e.currentTarget as HTMLImageElement).naturalWidth)}
            className={imgClassName}
            style={imgStyle}
          />
          {showHandles && (
            <>
              <span
                role="slider"
                aria-label="Resize image width (left handle)"
                aria-orientation="horizontal"
                aria-valuenow={ariaNow}
                aria-valuemin={IMAGE_MIN_WIDTH}
                aria-valuemax={ariaMax}
                tabIndex={0}
                onPointerDown={(e) => onHandlePointerDown(e, 'left')}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                onKeyDown={(e) => onHandleKeyDown(e, 'left')}
                className="absolute top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 w-1.5 h-10 bg-panel border border-acc rounded-sm cursor-ew-resize shadow-sm transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
              />
              <span
                role="slider"
                aria-label="Resize image width (right handle)"
                aria-orientation="horizontal"
                aria-valuenow={ariaNow}
                aria-valuemin={IMAGE_MIN_WIDTH}
                aria-valuemax={ariaMax}
                tabIndex={0}
                onPointerDown={(e) => onHandlePointerDown(e, 'right')}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
                onKeyDown={(e) => onHandleKeyDown(e, 'right')}
                className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-1.5 h-10 bg-panel border border-acc rounded-sm cursor-ew-resize shadow-sm transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100"
              />
            </>
          )}
          {editable && captionOn ? (
            <figcaption
              ref={captionRef as React.RefObject<HTMLElement>}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Image caption"
              data-placeholder="Add caption…"
              onInput={() => {
                dirtyRef.current = true;
              }}
              onBlur={onCaptionBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  dirtyRef.current = false;
                  if (captionRef.current) captionRef.current.textContent = caption ?? '';
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
              className="text-center text-sm text-t3 mt-1 outline-none select-text empty:before:content-[attr(data-placeholder)] empty:before:text-t4"
            >
              {caption ?? ''}
            </figcaption>
          ) : caption ? (
            <figcaption className="text-center text-sm text-t3 mt-1">{caption}</figcaption>
          ) : null}
        </figure>
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
 * (keeps `setImage` command + markdown `![](src)` paste rule + base attrs)
 * and adds: (1) a React NodeView that resolves vault-relative `src` to a
 * loadable `asset://` URL; (2) a paste/drop plugin that writes pasted/dropped
 * image files to the vault and inserts a vault-relative-src Image node;
 * (3) Phase 2/3 attrs: `width` (drag-resize), `dataAlign` (left/center/right),
 * `caption` (string, commit-on-blur = one undo step per edit session).
 * Captioned/aligned images serialize as `<figure><img><figcaption>`; bare
 * `<img>` otherwise (backward compatible with existing docs).
 */
export const RichTextImage = Image.extend({
  addOptions() {
    // ponytail: this.parent?.() returns ImageOptions | undefined, so the
    // spread widens every prop (e.g. inline: boolean → boolean | undefined)
    // which is incompatible with ImageOptions.inline: boolean. Cast back to
    // ImageOptions — safe at runtime (parent returns a complete options
    // object), the cast only silences the structural widening.
    return {
      ...this.parent?.(),
      onImagePaste: undefined as undefined | ImagePasteHandler,
    } as ImageOptions;
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('width') ?? el.querySelector('img')?.getAttribute('width') ?? null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.width ? { width: attrs.width } : {},
      },
      dataAlign: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const node = el.tagName === 'FIGURE' ? el : (el.querySelector('figure') ?? el);
          return node.getAttribute('data-align') ?? null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.dataAlign ? { 'data-align': attrs.dataAlign } : {},
      },
      caption: {
        default: null,
        parseHTML: (el: HTMLElement) => el.querySelector('figcaption')?.textContent ?? null,
        // node-level renderHTML emits <figcaption>; no per-attr renderHTML.
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    // ponytail: figureHTML returns a plain array shape that matches tiptap's
    // DOMOutputSpec; the cast bridges the loose array type from the pure
    // helper to the strict renderHTML signature without pulling the DOMOutputSpec
    // type into the pure helper's surface.
    return figureHTML(HTMLAttributes as Parameters<typeof figureHTML>[0]) as never;
  },

  addNodeView() {
    return ReactNodeViewRenderer(RichTextImageView);
  },
  addProseMirrorPlugins() {
    return [imagePasteDropPlugin(this.options.onImagePaste)];
  },
});
