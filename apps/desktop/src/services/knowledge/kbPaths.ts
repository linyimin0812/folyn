/**
 * `<vault>/__kb__/` 目录布局（ADR-0009 文件真源）。
 *
 * 全部路径是 vault 相对路径，交给 vaultStore.manager（tauriProvider）执行。
 */

export const KB_DIR = '__kb__';

export function kbManifestPath(): string {
  return `${KB_DIR}/manifest.json`;
}

export function kbSourceIndexPath(srcId: string): string {
  return `${KB_DIR}/sources/${srcId}.index.json`;
}

export function kbSourceSnapshotPath(srcId: string, versionHash: string): string {
  return `${KB_DIR}/sources/${srcId}/${versionHash}.md`;
}

export function kbTopicPagePath(tpId: string): string {
  return `${KB_DIR}/topics/${tpId}.md`;
}

export function kbTopicRefsPath(tpId: string): string {
  return `${KB_DIR}/topics/${tpId}.refs.json`;
}

export function kbNavigationPath(): string {
  return `${KB_DIR}/navigation.json`;
}

export function kbReviewsPath(): string {
  return `${KB_DIR}/reviews.json`;
}

export function kbDeletionsPath(): string {
  return `${KB_DIR}/deletions.json`;
}

/** 路径是否落在 `__kb__` 数据目录内（收录范围展开时排除）。 */
export function isKbPath(path: string): boolean {
  return path === KB_DIR || path.startsWith(`${KB_DIR}/`);
}
