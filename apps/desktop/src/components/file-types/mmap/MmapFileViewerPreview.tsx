import type { PreviewProps } from '../types';
import MindMapCanvas from './MindMapCanvas';

export function MmapFileViewerPreview(props: PreviewProps) {
  return <MindMapCanvas {...props} />;
}
