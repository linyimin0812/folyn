import type { FileTypeHandler } from '../types';
import { HtmlPreview } from './HtmlPreview';

const handler: FileTypeHandler = {
  id: 'html',
  extensions: ['html', 'htm'],
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'preview',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: HtmlPreview,
};

export default handler;
