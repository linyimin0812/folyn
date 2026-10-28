/**
 * 知识库逻辑路径（ADR-0011）。
 *
 * 全部路径仍按 `__kb__/...` 相对派生（同步、与存储根无关）；执行层
 * （vaultKbFs）按前缀路由：`__kb__` 生成物 → `~/.folyn/vaults/<vaultId>/`
 * 绝对路径走 tauri fs，源资料 → vaultStore.manager（vault 相对）。磁盘布局
 * 见 ADR-0009/0011；manifest 中记录的主题页路径保持本层语义不变。
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
