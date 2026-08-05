import { useState, useEffect } from 'react';
import { ZoomableImage } from './ZoomableImage';

export function FileImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string>('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke = '';
    import('@tauri-apps/plugin-fs').then(({ readFile }) =>
      readFile(path).then((bytes) => {
        const ext = path.split('.').pop()?.toLowerCase() || 'png';
        const mime =
          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'gif' ? 'image/gif'
              : ext === 'webp' ? 'image/webp'
                : ext === 'svg' ? 'image/svg+xml'
                  : ext === 'bmp' ? 'image/bmp'
                    : 'image/png';
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        revoke = url;
        setSrc(url);
      }),
    ).catch(() => setFailed(true));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [path]);
  if (failed) return <span className="inline-flex items-center gap-1 text-[11px] py-0.5 px-1.5 bg-surf border border-brd rounded-md text-t2">🖼 {alt}</span>;
  if (!src) return null;
  return <ZoomableImage src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
