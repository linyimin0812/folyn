import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { PlantUmlPreview } from './PlantUmlPreview';

const handler: FileTypeHandler = {
  id: 'plantuml',
  extensions: ['puml', 'pu', 'plantuml'],
  icon: getFileTypeIcon('plantuml'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: PlantUmlPreview,
};

export default handler;
