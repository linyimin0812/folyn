import { useEffect, useState } from 'react';

/**
 * Image with click-to-zoom. Renders the thumbnail as-is; clicking it opens a
 * fullscreen lightbox (fixed overlay, image centered at up to 90vw/90vh).
 * The overlay closes on backdrop/image click or Escape. Used for message
 * attachment thumbnails and assistant-generated inline images.
 */
export function ZoomableImage({
  src,
  alt = '',
  className,
  onError,
}: {
  src: string;
  alt?: string;
  /** Applied to the thumbnail <img>. */
  className?: string;
  /** Forwarded to the thumbnail <img> (e.g. FileImage's failure fallback). */
  onError?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on Escape + lock body scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={`${className ?? ''} cursor-zoom-in`.trim()}
        onClick={() => setOpen(true)}
        onError={onError}
      />
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 cursor-zoom-out"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={alt || '图片预览'}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded cursor-zoom-out"
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
