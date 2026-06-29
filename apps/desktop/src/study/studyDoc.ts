// 学习主题文档在 vault 中的落盘约定：目录根 `学习/`，每主题一个 `<slug>.md`。
// slug 同时写入 front-matter，作为稳定 id 前缀与 schedule 回链 `study:<slug>` 的值。
// 文件名 stem 必须与 front-matter slug 一致（createTopic 保证），故 path 可由 slug 推导；
// 但 saveTopic 仍通过 store 的 pathsBySlug 查表，兼容用户手改文件名后的漂移。

import type { ParsedStudy } from './types';

/** 学习主题文档的 vault 目录根。 */
export const STUDY_DIR = '学习';

/**
 * 把主题标题 slug 化为文件名安全串。保留 CJK（与 clipService.toSlug 同策略），
 * 其余非字母数字字符折叠为 `-`。空串回退 `topic`。
 */
export function slugifyTopic(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'topic';
}

/** 构造一个空学习主题文档的 markdown 文本（含四段标题 + front-matter）。 */
export function buildEmptyStudyDoc(title: string, slug: string, created: string): string {
  return [
    '---',
    `title: "${title}"`,
    `slug: ${slug}`,
    `created: ${created}`,
    '---',
    '',
    '## 资料',
    '',
    '## 计划',
    '',
    '## 笔记',
    '',
    '## 复习',
    '',
  ].join('\n');
}

/** 由 slug 推导主题文档在 vault 中的相对路径。 */
export function studyDocPath(slug: string): string {
  return `${STUDY_DIR}/${slug}.md`;
}

/** 从一段 markdown 的 front-matter 解析 slug；缺失时回退到 fallback（通常是文件名 stem）。 */
export function extractSlug(content: string, fallback: string): string {
  const lines = content.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') return fallback;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    const m = /^slug:\s*(.*)$/.exec(lines[i]);
    if (m) return m[1].trim().replace(/^"(.*)"$/, '$1');
  }
  return fallback;
}

/** 在 store 中携带 path 信息的主题视图（PR3 四区直接消费 ParsedStudy 字段）。 */
export interface StudyTopicEntry {
  slug: string;
  path: string;
  parsed: ParsedStudy;
}
