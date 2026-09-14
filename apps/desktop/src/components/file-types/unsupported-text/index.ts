import type { ReactElement } from 'react';
import { createElement } from 'react';
import type { FileTypeProvider } from '../types';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { UnsupportedFileView } from '../unsupported/UnsupportedFileView';

/**
 * Catch-all provider for text-but-extension-required files (e.g. .dbml /
 * .richtext when the dedicated extension isn't installed). Unlike the binary
 * `unsupported` handler, these ARE text, so we expose a plain-text edit
 * mode (CodeMirror) alongside the preview notice. Assigned by
 * `detectFileType`; not matched by extension. Icon = `unknown`.
 */
const handler: FileTypeProvider = {
  id: 'unsupported-text',
  extensions: [],
  needsFileContent: true,
  defaultMode: 'split',
  icon: createElement(ThemeIcon, { name: 'unknown' }) as ReactElement,
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'preview', kind: 'component', component: UnsupportedFileView },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
  ],
};

export default handler;
