import type { PreviewProps } from '../types';

export function JsonFileViewerPreview({ content, filePath }: PreviewProps) {
  const name = filePath.split('/').pop() || 'data.json';
  const body = content ?? '';
  const lines = body.length === 0 ? 0 : body.split('\n').length;

  return (
    <div className="h-full w-full overflow-auto bg-panel p-4 text-fg">
      <div className="mb-3 text-sm text-fg-muted">
        {name} · {lines} lines
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-sm">
        {content ?? ''}
      </pre>
    </div>
  );
}
