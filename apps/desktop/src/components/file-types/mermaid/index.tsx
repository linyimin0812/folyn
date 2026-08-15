import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { MermaidPreview } from './MermaidPreview';

const handler: FileTypeHandler = {
  id: 'mermaid',
  extensions: ['mermaid', 'mmd'],
  icon: getFileTypeIcon('mermaid'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: MermaidPreview,
};

export default handler;
