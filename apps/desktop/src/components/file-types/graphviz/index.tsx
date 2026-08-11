import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { GraphvizPreview } from './GraphvizPreview';

const handler: FileTypeHandler = {
  id: 'graphviz',
  extensions: ['gv', 'dot', 'graphviz'],
  icon: getFileTypeIcon('graphviz'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: GraphvizPreview,
};

export default handler;
