/**
 * Icons capability: the host's own file icons as markup.
 *
 * The extension lists remote files, so it has no vault entry to hand the file
 * tree; rendering the same `<FileIcon>` the tree renders keeps the icons — and
 * their light/dark variants — identical to the vault without duplicating the
 * extension map in the extension.
 */

import type { ExtensionIconsCapability, ExtensionIcon } from '@folyn/extension-host';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FileIcon } from '@/components/icons/FileIcon';

export function buildExtensionIcons(): ExtensionIconsCapability {
  return {
    async render(fileName, opts): Promise<ExtensionIcon> {
      return { svg: renderToStaticMarkup(createElement(FileIcon, { filename: fileName, isDir: opts?.isDir })) };
    },
  };
}
