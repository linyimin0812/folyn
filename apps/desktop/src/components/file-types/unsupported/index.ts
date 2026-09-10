import type { ReactElement } from 'react';
import { createElement } from 'react';
import type { FileTypeProvider } from '../types';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { UnsupportedFileView } from './UnsupportedFileView';

/**
 * Catch-all provider for files no other provider claims AND that are known
 * non-text formats (see `binaryExtensions.ts`). Renders an "unsupported file
 * type" message instead of the raw bytes. Assigned by `detectFileType`; not
 * matched by extension. Icon = the app's `unknown` theme icon.
 */
const handler: FileTypeProvider = {
  id: 'unsupported',
  extensions: [],
  // Never read the file — a binary format would only garble the editor.
  needsFileContent: false,
  defaultMode: 'preview',
  icon: createElement(ThemeIcon, { name: 'unknown' }) as ReactElement,
  modes: [
    { id: 'preview', kind: 'component', component: UnsupportedFileView },
  ],
};

export default handler;
