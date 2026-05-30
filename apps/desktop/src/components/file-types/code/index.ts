import type { FileTypeHandler } from '../types';

const handler: FileTypeHandler = {
  id: 'code',
  extensions: [],
  supportedViewModes: ['edit'],
  needsFileContent: true,
  useCodeMirror: true,
};

export default handler;
