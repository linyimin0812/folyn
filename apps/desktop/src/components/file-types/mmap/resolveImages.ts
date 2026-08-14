// ponytail: markmap-lib's Transformer turns `![alt](rel.png)` into
// <img src="rel.png"> in each node's HTML content, but it doesn't know
// about the vault root or the file's directory — so a relative image
// path renders as a broken <img> inside the foreignObject. Walk the
// transformed tree and rewrite img srcs the same way MarkdownPreview
// does (Tauri asset protocol + vault/file-dir resolution). Sync because
// the resolution is pure string ops + convertFileSrc (no disk reads).

import { convertFileSrc } from '@tauri-apps/api/core';
import type { IPureNode } from 'markmap-common';

export function resolveImgSrc(src: string, filePath: string, vaultRoot: string): string {
  if (!src) return src;
  if (/^(https?:|data:|file:|blob:)/.test(src)) return src;
  const imagePath = decodeURIComponent(src.replace(/^\.\//, ''));
  if (filePath.startsWith('/') || filePath.startsWith('~') || /^[A-Za-z]:[\/]/.test(filePath)) {
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
    const absPath = dir ? `${dir}/${imagePath}` : imagePath;
    return convertFileSrc(absPath);
  }
  if (!vaultRoot) return src;
  const fileDir = filePath ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
  let absPath: string;
  if (fileDir && imagePath.startsWith(fileDir + '/')) {
    absPath = `${vaultRoot}/${imagePath}`;
  } else if (fileDir) {
    absPath = `${vaultRoot}/${fileDir}/${imagePath}`;
  } else {
    absPath = `${vaultRoot}/${imagePath}`;
  }
  return convertFileSrc(absPath);
}

export function resolveImagesInTree(node: IPureNode, filePath: string, vaultRoot: string): void {
  if (node.content && node.content.includes('<img ')) {
    node.content = node.content.replace(
      /<img\b([^>]*?)src="([^"]+)"/g,
      (m, attrs: string, src: string) =>
        `<img${attrs}src="${resolveImgSrc(src, filePath, vaultRoot)}"`,
    );
  }
  if (node.children) {
    for (const c of node.children) resolveImagesInTree(c, filePath, vaultRoot);
  }
}
