import type { ReactElement } from 'react';
import { createElement } from 'react';
import type { FileTypeProvider } from '../types';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { UnsupportedFileView } from '../unsupported/UnsupportedFileView';

/**
 * Catch-all provider for a text format an installed extension declares while
 * that extension is not active (disabled, or awaiting approval). Unlike the binary
 * `unsupported` handler, these ARE text, so we keep a plain-text edit mode
 * (CodeMirror) declared for split's left pane, but hide it from the switcher
 * — opening defaults to `preview`, with `split` available alongside. Icon =
 * `unknown`. Assigned by `detectFileType`; not matched by extension.
 */
const handler: FileTypeProvider = {
  id: 'unsupported-text',
  extensions: [],
  needsFileContent: true,
  defaultMode: 'preview',
  icon: createElement(ThemeIcon, { name: 'unknown' }) as ReactElement,
  modes: [
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: UnsupportedFileView },
    { id: 'edit', kind: 'shell-editor', hidden: true },
  ],
};

export default handler;
