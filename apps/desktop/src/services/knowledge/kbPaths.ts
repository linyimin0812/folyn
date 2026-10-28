/**
 * `<vault>/__kb__/` 目录布局（ADR-0009 文件真源）。
 *
 * 全部路径是 vault 相对路径，交给 vaultStore.manager（tauriProvider）执行。
 */

export const KB_DIR = '__kb__';

export function kbManifestPath(root = KB_DIR): string {
  return `${root}/manifest.json`;
}

export function kbSourceIndexPath(srcId: string, root = KB_DIR): string {
  return `${root}/sources/${srcId}.index.json`;
}

export function kbSourceSnapshotPath(srcId: string, versionHash: string, root = KB_DIR): string {
  return `${root}/sources/${srcId}/${versionHash}.md`;
}

export function kbTopicPagePath(tpId: string, root = KB_DIR): string {
  return `${root}/topics/${tpId}.md`;
}

export function kbTopicRefsPath(tpId: string, root = KB_DIR): string {
  return `${root}/topics/${tpId}.refs.json`;
}

export function kbNavigationPath(root = KB_DIR): string {
  return `${root}/navigation.json`;
}

export function kbReviewsPath(root = KB_DIR): string {
  return `${root}/reviews.json`;
}

export function kbDeletionsPath(root = KB_DIR): string {
  return `${root}/deletions.json`;
}

/** 路径是否落在 `__kb__` 数据目录内（收录范围展开时排除）。 */
export function isKbPath(path: string): boolean {
  return path === KB_DIR || path.startsWith(`${KB_DIR}/`);
}

export const kbThemeRegistryPath = `${KB_DIR}/themes.json`;

export function kbThemeRoot(themeId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(themeId)) throw new Error('Invalid knowledge theme id');
  return `${KB_DIR}/themes/${themeId}`;
}
