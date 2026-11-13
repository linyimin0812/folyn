import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ZoomPanCanvas } from '../image/ZoomPanCanvas';

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

// The portal's DOM lives in <body>, but React synthetic events still bubble
// up the component tree into the preview (link/selection/sync handlers).
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Fullscreen viewer for a preview image: the same resolved src in
 * ZoomPanCanvas, so it opens at 1:1 (crisp) with pan/zoom/Fit. Closes on the
 * close button, Escape, or a click on the dimmed margin around the canvas —
 * the canvas itself is a pan surface, so clicks on it never close.
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    // Capture: close before the editor / other global Esc handlers react.
    // PresentationOverlay (also window-capture, registered earlier) skips
    // while `.image-lightbox` is in the DOM.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="image-lightbox fixed inset-0 z-[9999] bg-black/60 p-10 flex"
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Image'}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onDoubleClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <div className="flex-1 min-w-0 rounded-lg overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,.35)]">
        <ZoomPanCanvas src={src} alt={alt} className="image-lightbox-canvas" />
      </div>
      <button
        type="button"
        className="absolute top-2 right-2 w-7 h-7 rounded-md border-none bg-transparent text-white/80 text-lg leading-none cursor-pointer flex items-center justify-center hover:bg-white/15 hover:text-white"
        onClick={onClose}
        title="Close"
        aria-label="Close"
      >
        ×
      </button>
    </div>,
    document.body,
  );
}
