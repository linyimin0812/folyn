// 学习主题文档在 vault 中的落盘约定：目录根 `__study__/`（feature 级目录，兼作 study agent cwd），
// 每主题一个 `<slug>.md`。slug 同时写入 front-matter，作为稳定 id 前缀与 schedule 回链 `study:<slug>` 的值。
// 文件名 stem 必须与 front-matter slug 一致（createTopic 保证），故 path 可由 slug 推导；
// 但 saveTopic 仍通过 store 的 pathsBySlug 查表，兼容用户手改文件名后的漂移。

import type { ParsedStudy } from './types';

/** 学习主题文档的 vault 目录根（feature 级目录，兼作 study agent cwd）。 */
export const STUDY_DIR = '__study__';

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
    '## 检测',
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

const H2_RE = /^##\s+(.+?)\s*#*\s*$/;
const NOTES_HEADING = '笔记';

/**
 * 在 `## 笔记` 非托管段尾追加一行（原样保留已有内容）。段不存在则在文件末尾新建。
 *
 * 笔记段不被 serializeStudy 托管（散文式），所以精细加工模板等追加走本函数：
 * 直接对全文文本做行级 splice，只插入、不改写既有行，避免破坏用户笔记。
 */
export function appendToNotesSection(content: string, line: string): string {
  const lines = content.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const m = H2_RE.exec(lines[i]);
    if (m && m[1].trim() === NOTES_HEADING) {
      start = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (H2_RE.test(lines[j])) { end = j; break; }
      }
      break;
    }
  }
  if (start < 0) {
    // 段不存在：在文件末尾新建（保留一个空行分隔）
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`## ${NOTES_HEADING}`);
    lines.push(line);
    return lines.join('\n');
  }
  // 段尾回退掉尾部空行，再追加，保持段内紧凑
  let insertAt = end;
  while (insertAt - 1 > start && lines[insertAt - 1].trim() === '') insertAt -= 1;
  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}

/** 精细加工要点模板行（写入 `## 笔记` 段）。 */
export const ELABORATION_TEMPLATE =
  '- **概念**: … | 因为: … | 例子: … | 类比: [[]]';

// ── SQ3R 预读 callout 解析 / 写入 ──
//
// callout 形态（agent 产出 → 前端原样写入 `## 笔记` 段尾）：
//   :::callout{type="info" title="预读问题：{materialTitle}"}
//   <body：大纲 + 预读问题>
//   :::
// title 中的 materialTitle 作为 per-material 标识——再次点同资料 SQ3R 时
// 直接读对应 callout 展示，不必重新调 AI。

const SQ3R_CALLOUT_OPEN_RE = /^:::callout\{[^}]*title="预读问题：([^"]+)"[^}]*\}\s*$/;
const CALLOUT_CLOSE_RE = /^:::\s*$/;

/**
 * 扫 `## 笔记` 段（或全文）找指定资料的 SQ3R callout，返回其 body 文本。
 * 命中返回 { body }（body 不含 open/close 行）；未命中返回 null。
 */
export function findSq3rCallout(content: string, materialTitle: string): { body: string } | null {
  const lines = content.split('\n');
  let i = 0;
  // 限定在 `## 笔记` 段内（若段不存在，扫全文尾段兜底）。
  let end = lines.length;
  for (; i < lines.length; i++) {
    const m = H2_RE.exec(lines[i]);
    if (m && m[1].trim() === NOTES_HEADING) {
      for (let j = i + 1; j < lines.length; j++) {
        if (H2_RE.test(lines[j])) { end = j; break; }
      }
      i += 1; // 进入段体
      break;
    }
  }
  for (; i < end; i++) {
    const m = SQ3R_CALLOUT_OPEN_RE.exec(lines[i]);
    if (!m) continue;
    if (m[1] !== materialTitle) {
      // 跳过本 callout 块（直到 close），继续找下一个
      for (i += 1; i < end; i++) {
        if (CALLOUT_CLOSE_RE.test(lines[i])) break;
      }
      continue;
    }
    // 命中——收集 body 到下一个 ::: 行
    const body: string[] = [];
    for (i += 1; i < end; i++) {
      if (CALLOUT_CLOSE_RE.test(lines[i])) break;
      body.push(lines[i]);
    }
    // 去掉首尾空行，保持紧凑
    while (body.length && body[0].trim() === '') body.shift();
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    return { body: body.join('\n') };
  }
  return null;
}

/**
 * 把 SQ3R callout 写入 / 替换到 `## 笔记` 段尾。
 * 若该资料已有同 title callout → 替换 body；否则段尾追加新 callout 块。
 * 段不存在则在文件末尾新建。原样保留其它行（散文、其它 callout）。
 */
export function upsertSq3rCallout(content: string, materialTitle: string, calloutBody: string): string {
  const lines = content.split('\n');
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const m = H2_RE.exec(lines[i]);
    if (m && m[1].trim() === NOTES_HEADING) {
      start = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (H2_RE.test(lines[j])) { end = j; break; }
      }
      break;
    }
  }
  // 段不存在：在文件末尾新建并写入
  if (start < 0) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push(`## ${NOTES_HEADING}`);
    lines.push('');
    lines.push(...buildSq3rCalloutLines(materialTitle, calloutBody));
    return lines.join('\n');
  }

  // 段内找已有同 title callout → 替换其 body
  for (let i = start + 1; i < end; i++) {
    const m = SQ3R_CALLOUT_OPEN_RE.exec(lines[i]);
    if (!m || m[1] !== materialTitle) {
      // 不是目标 callout——若它是任意 callout，跳到 close 行，避免误改
      if (/^:::callout\{/.test(lines[i])) {
        for (i += 1; i < end; i++) {
          if (CALLOUT_CLOSE_RE.test(lines[i])) break;
        }
      }
      continue;
    }
    // 命中——定位 close 行，splice 替换中间 body
    let closeIdx = i + 1;
    while (closeIdx < end && !CALLOUT_CLOSE_RE.test(lines[closeIdx])) closeIdx += 1;
    const newBlock = buildSq3rCalloutLines(materialTitle, calloutBody);
    // newBlock = [open, ...bodyLines, close]；open 与 close 行复用，只换中间 body
    const newBody = newBlock.slice(1, -1);
    lines.splice(i + 1, closeIdx - i - 1, ...newBody);
    return lines.join('\n');
  }

  // 段内无目标 callout → 段尾追加新 callout 块（前后空行分隔）
  let insertAt = end;
  while (insertAt - 1 > start && lines[insertAt - 1].trim() === '') insertAt -= 1;
  if (insertAt > start && lines[insertAt - 1].trim() !== '') lines.splice(insertAt, 0, '');
  lines.splice(insertAt, 0, ...buildSq3rCalloutLines(materialTitle, calloutBody));
  return lines.join('\n');
}

/** 构造 SQ3R callout 块的行数组（含 open / close 行，body 前后留空行）。 */
function buildSq3rCalloutLines(materialTitle: string, calloutBody: string): string[] {
  return [
    `:::callout{type="info" title="预读问题：${materialTitle}"}`,
    ...calloutBody.split('\n'),
    ':::',
  ];
}
