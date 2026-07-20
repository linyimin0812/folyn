import { useEffect, useState } from 'react';
import { DrawIoEmbed } from 'react-drawio';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { PreviewProps } from '../types';

// ponytail: online embed via https://embed.diagrams.net — requires internet to view.
// Ceiling: CDN downtime breaks the preview (file XML persists on disk, no data loss).
// Upgrade path: bundle drawio-desktop web assets (~30MB) into public/drawio/ and pass
// `baseUrl="/drawio/index.html"` to DrawIoEmbed. Defer until offline use is a real requirement.

export function DrawioPreview({ content }: PreviewProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
  }, [content]);

  return (
    <div className="w-full h-full relative">
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          加载中…
        </div>
      )}
      <DrawIoEmbed
        key={theme}
        xml={content}
        urlParameters={{ dark: theme === 'dark', chrome: true }}
        onLoad={() => setReady(true)}
      />
    </div>
  );
}
