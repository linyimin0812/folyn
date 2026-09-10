import type { FileTypeProvider } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { PlantUmlPreview } from './PlantUmlPreview';

const handler: FileTypeProvider = {
  id: 'plantuml',
  extensions: ['puml', 'pu', 'plantuml'],
  icon: getFileTypeIcon('plantuml'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: PlantUmlPreview },
  ],
};

export default handler;
