import { lazy, Suspense } from 'react';
import type { FileTypeHandler, PreviewProps } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

// Lazy-load the x6-backed ER renderer so the @antv/x6 + react-shape chunks
// (≈120KB gz) stay out of the main bundle and load only when a .dbml preview
// is first opened. Mirrors the dynamic-import pattern used for @dbml/core in
// parseDbml.ts.
const ErDiagramPreview = lazy(() => import('./ErDiagramX6'));

function ErPreviewWithFallback(props: PreviewProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full w-full text-[13px] text-[var(--t3)] bg-[var(--bg)]">
          正在加载 ER 渲染器…
        </div>
      }
    >
      <ErDiagramPreview {...props} />
    </Suspense>
  );
}

const handler: FileTypeHandler = {
  id: 'dbml',
  extensions: ['dbml'],
  icon: getFileTypeIcon('dbml'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: ErPreviewWithFallback,
};

export default handler;
