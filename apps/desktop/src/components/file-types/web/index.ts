import type { FileTypeHandler } from '../types';
import { WebViewer } from './WebViewer';

const handler: FileTypeHandler = {
  id: 'web',
  extensions: [],
  icon: '🌐',
  supportedViewModes: ['edit'],
  needsFileContent: false,
  useCodeMirror: false,
  Editor: WebViewer,
};

export default handler;
