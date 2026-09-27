import { useEffect, useState, createElement } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveAbsolutePath } from '@/services/externalFileProvider';
import { ExcalidrawPreview } from '../excalidraw/ExcalidrawPreview';
import { ResizableMedia } from './ResizableMedia';

/**
 * Async img renderer: resolves `~/` and `$HOME/`-prefixed paths via Tauri
 * path APIs (homeDir is async), then converts to an asset:// URL via
 * `convertFileSrc`. Absolute paths (`/…`, `C:\…`) pass straight to
 * `convertFileSrc`. Vault-relative and `./` `../` paths join against
 * `assetBase` (the document's directory). Excalidraw paths route through
 * ExcalidrawPreview. Wrapped in ResizableMedia when a source line is
 * attached (for drag-resize writeback).
 */
export function VaultImageInner(props: {
  src?: string;
  alt?: string;
  rest: Record<string, any>;
  sourceLine?: number;
  filePath: string;
  assetBase: string;
  contentRef: React.MutableRefObject<string>;
  onChangeRef: React.MutableRefObject<((content: string) => void) | undefined>;
}): React.ReactElement {
  const { src, alt, rest, sourceLine, filePath, assetBase, contentRef, onChangeRef } = props;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  // ponytail: resolve ~ / $HOME / absolute / vault-relative paths. Synchronous
  // for http/data/absolute; async for ~/ and $HOME/ (homeDir() IPC) AND for
  // relative paths with ../ segments (join+normalize IPC to resolve them).
  // The effect re-runs when src or assetBase changes.
  useEffect(() => {
    let cancelled = false;
    if (!src || src.startsWith('http') || src.startsWith('data:')) {
      setResolvedSrc(src ?? '');
      return () => { cancelled = true; };
    }
    const rawPath = src.replace(/^\.\//, '');
    const imagePath = decodeURIComponent(rawPath);
    const isHomeRel = imagePath.startsWith('~/') || imagePath.startsWith('$HOME/');
    const isAbs = /^(\/|[A-Za-z]:[\\/])/.test(imagePath);
    const hasRelSegments = /(?:^|\/|\\)\.\.?(?:\/|\\|$)/.test(imagePath);

    if (isHomeRel) {
      resolveAbsolutePath(imagePath).then((abs) => {
        if (!cancelled) setResolvedSrc(convertFileSrc(abs));
      }).catch(() => {
        if (!cancelled) setResolvedSrc(src);
      });
    } else if (isAbs) {
      setResolvedSrc(convertFileSrc(imagePath));
    } else if (assetBase) {
      if (hasRelSegments) {
        // ../ and ./ segments must be normalized — convertFileSrc can't
        // resolve them from the asset:// URL alone.
        import('@tauri-apps/api/path').then(({ join, normalize }) =>
          join(assetBase, imagePath).then((joined) => normalize(joined)),
        ).then((abs) => {
          if (!cancelled) setResolvedSrc(convertFileSrc(abs));
        }).catch(() => {
          if (!cancelled) setResolvedSrc(convertFileSrc(`${assetBase}/${imagePath}`));
        });
      } else {
        setResolvedSrc(convertFileSrc(`${assetBase}/${imagePath}`));
      }
    } else {
      setResolvedSrc(src);
    }
    return () => { cancelled = true; };
  }, [src, assetBase]);

  if (!src || src.startsWith('http') || src.startsWith('data:')) {
    const imgEl = createElement('img', { src, alt, ...rest });
    if (sourceLine == null) return imgEl;
    return createElement(ResizableMedia, { kind: 'img', sourceLine, contentRef, onChangeRef }, imgEl);
  }

  const rawPath = src.replace(/^\.\//, '');
  const imagePath = decodeURIComponent(rawPath);
  const isHomeRel = imagePath.startsWith('~/') || imagePath.startsWith('$HOME/');
  const isAbs = /^(\/|[A-Za-z]:[\\/])/.test(imagePath);
  const isExternal = isHomeRel || isAbs;

  if (imagePath.endsWith('.excalidraw')) {
    const fileDir = filePath ? filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))) : '';
    const vaultPath = isExternal ? imagePath : (fileDir ? `${fileDir}/${imagePath}` : imagePath);
    const imgEl = createElement(ExcalidrawPreview, { filePath: vaultPath, alt });
    if (sourceLine == null) return imgEl;
    return createElement(ResizableMedia, { kind: 'img', sourceLine, contentRef, onChangeRef }, imgEl);
  }

  const imgEl = createElement('img', {
    src: resolvedSrc ?? src,
    alt,
    loading: 'lazy',
    ...rest,
  });
  if (sourceLine == null) return imgEl;
  return createElement(ResizableMedia, { kind: 'img', sourceLine, contentRef, onChangeRef }, imgEl);
}
