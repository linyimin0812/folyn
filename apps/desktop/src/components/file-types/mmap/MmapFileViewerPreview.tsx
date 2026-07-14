import { lazy, Suspense } from 'react';
import type { PreviewProps } from '../types';

const MindMapCanvas = lazy(() => import('./MindMapCanvas'));

export function MmapFileViewerPreview(props: PreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full w-full text-[13px] text-[var(--t3)] bg-[var(--bg)]">
          正在加载思维导图渲染器…
        </div>
      }
    >
      <MindMapCanvas {...props} />
    </Suspense>
  );
}
