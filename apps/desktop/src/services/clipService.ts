import { createAdapter, type CliAdapter } from '@mochi/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import * as editorIoService from '@/services/editorIoService';
import { useAiConfigStore, getFeatureAdapter, getFeatureCliPath } from '@/store/aiConfigStore';
import { collectTextFromStream, extractJsonObject, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';
import { isHttpUrl } from '@/utils/urlUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import {
  normalizeInfographicDoc,
  serializeInfographicSection,
  type InfographicDoc,
  type InfographicBlock,
} from '@/features/clips/clipParse';

export type ClipLanguage = 'en' | 'zh' | 'auto';

// Re-export infographic types so callers can import everything from clipService.
export type { InfographicDoc, InfographicBlock };

// ponytail: prompt previously lived in services/skillDefaults.ts and was
// overridable via the Skills settings page. After removing that page the
// template is inlined here. planMyDayService keeps its own copy to avoid
// pulling clipParse (excalidraw / roughjs) into its test import graph.
const CLIP_CARD_PROMPT = `# Web Clip Card Generation

你是一个网页内容分析助手。请按照以下步骤分析网页内容并生成结构化知识卡片。

## 重要规则
- **不要使用 Write 或任何文件创建工具将结果保存到磁盘。** 应用会自动处理保存。
- 只在回复文本中输出 JSON 结果。

## 步骤

1. **获取网页内容**：使用 WebFetch 工具获取用户提供的 URL 内容
2. **分析内容**：阅读并理解网页的核心主题、关键信息
3. **生成知识卡片**：按照下方 JSON 格式输出结构化卡片

## 输出格式

请以 JSON 格式回复（不要使用 markdown 代码块包裹）：
{
  "title": "网页标题",
  "tags": ["tag1", "tag2", "tag3"],
  "suggestedTags": ["tag4", "tag5", "tag6", "tag7", "tag8"],
  "summary": "2-4句话概括核心内容",
  "keyPoints": [
    "要点1: 一句话描述关键信息",
    "要点2: 一句话描述关键信息",
    "要点3: 一句话描述关键信息"
  ]
}

## 规则
- tags 字段生成恰好 3-5 个简洁的关键词标签
- suggestedTags 字段额外提供 5-8 个候选标签，供用户选择添加
- 摘要概括核心内容，2-4句话
- 要点提取3-8条最重要的信息，每条一句话
- 所有输出内容使用与网页内容相同的语言`;

interface ClipCard {
  title: string;
  tags: string[];
  suggestedTags: string[];
  summary: string;
  keyPoints: string[];
  pageContent: string;
}

/** Metadata returned by generateClip, consumed by saveClip */
export interface ClipMetadata {
  title: string;
  tags: string[];
  suggestedTags: string[];
  summary: string;
  keyPoints: string[];
  url: string;
  /** Full page markdown fetched via curl.md at card-gen time. Written to the
   *  `## 正文` section of the clip file by `saveClip` so the infographic
   *  agent has real source material offline (dead-link-safe). Empty string
   *  (or undefined) when the agent didn't return one (older clips lack the
   *  section). Optional so legacy callers that construct ClipMetadata
   *  literals don't have to specify it. */
  pageContent?: string;
}

/** Result of `generateClip`: card metadata + (optionally) the auto-generated
 *  infographic. The infographic is produced by chaining a second agent call
 *  in infographic-mode right after the card-metadata call; `null` when the
 *  second call fails (the clip must still succeed — infographic is a
 *  best-effort enhancement, not a hard requirement). */
export interface GenerateClipResult {
  metadata: ClipMetadata;
  infographic: InfographicDoc | null;
}

export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'clip';
}

function validateUrl(url: string): void {
  if (!isHttpUrl(url)) {
    throw new Error('无效的网址，请输入以 http:// 或 https:// 开头的链接');
  }
}

/**
 * Phase 1: Generate metadata via AI, then chain a second agent call in
 * infographic-mode to auto-generate the poster. Claude Code handles
 * fetching the URL content via its own tools (curl.md). Does NOT save to
 * disk — returns `{ metadata, infographic }` for user confirmation.
 *
 * The infographic call is best-effort: if it fails (parse error, agent
 * crash, etc.), `infographic` is `null` and the clip still succeeds. The
 * user can re-clip later to retry the infographic.
 */
export async function generateClip(
  url: string,
  onProgress?: (msg: string) => void,
  _lang: ClipLanguage = 'auto',
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<GenerateClipResult> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');
  validateUrl(url);

  onProgress?.('AI 正在分析网页...');
  const aiConfig = useAiConfigStore.getState();
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // clips agent cwd = `<vault>/__clips__/`：agent 自动发现 `.claude/agents/clips.md`。
  const workingDir = `${basePath.replace(/\/+$/, '')}/__clips__`;

  const adapter = createAdapter(getFeatureAdapter('clips', aiConfig));

  let card: ClipCard;
  let infographic: InfographicDoc | null = null;
  try {
    await adapter.start({ cliPath: getFeatureCliPath('clips', aiConfig), workingDir });

    // --- Phase 1: card metadata via curl.md ---------------------------------
    // curl.md service: GET https://curl.md/<encoded original URL> → optimized Markdown.
    // The agent WebFetches this curl.md URL (not the raw page URL) to get the page
    // content already converted to Markdown. The original URL is still conveyed for
    // title / source context.
    const mdUrl = 'https://curl.md/' + encodeURIComponent(url);
    const prompt = `${CLIP_CARD_PROMPT}\n\n## Task\n请分析以下网页并生成知识卡片元数据。\n原始 URL（仅作来源/标题参考）：${url}\n用 WebFetch 抓取 curl.md 版本：${mdUrl}`;

    const textPromise = collectTextFromStream(adapter, onStream, onEvent);
    await adapter.send(prompt, await getFeatureAgentSendOptions('clips'));
    const aiText = await textPromise;

    try {
      const jsonStr = extractJsonObject(aiText);
      const parsed = JSON.parse(jsonStr ?? aiText);
      card = {
        title: parsed.title || 'Untitled',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : [],
        summary: parsed.summary || '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
        pageContent: typeof parsed.pageContent === 'string' ? parsed.pageContent : '',
      };
    } catch {
      throw new Error('AI 返回的内容无法解析为知识卡片');
    }

    // --- Phase 2: chained infographic-mode call -----------------------------
    // Best-effort: a failure here MUST NOT fail the whole clip. We catch
    // everything and surface `infographic: null` so saveClip skips writing
    // the `## 信息图` section. The user can re-clip to retry.
    try {
      onProgress?.('AI 正在生成信息图...');
      infographic = await runInfographicAgent(adapter, {
        title: card.title,
        url,
        hostname: (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
        summary: card.summary,
        keyPoints: card.keyPoints,
        pageContent: card.pageContent,
        onStream,
        onEvent,
      });
    } catch {
      infographic = null;
    }
  } finally {
    await adapter.stop();
  }

  const metadata: ClipMetadata = {
    title: card.title,
    tags: card.tags,
    suggestedTags: card.suggestedTags,
    summary: card.summary,
    keyPoints: card.keyPoints,
    pageContent: card.pageContent,
    url,
  };

  return { metadata, infographic };
}

/**
 * Internal helper: invoke the clips agent in `[infographic-mode]` against
 * the already-fetched card metadata (no WebFetch — content is embedded in
 * the prompt). Returns the parsed `InfographicDoc`, or throws on parse /
 * shape failure (the caller is expected to catch and downgrade to `null`).
 *
 * The adapter must already be started; this function only sends the
 * infographic prompt and parses the response. Used by `generateClip` for
 * the chained auto-generation flow.
 */
async function runInfographicAgent(
  adapter: CliAdapter,
  input: {
    title: string;
    url: string;
    hostname: string;
    summary: string;
    keyPoints: string[];
    pageContent: string;
    onStream?: (chunk: string) => void;
    onEvent?: (event: StreamEvent) => void;
  },
): Promise<InfographicDoc> {
  const keyPointsBlock = input.keyPoints.length > 0
    ? input.keyPoints.map((p) => `- ${p}`).join('\n')
    : '（无要点）';
  // Build the prompt. When `## 正文` (full page markdown from curl.md) is
  // present, pass it so the agent has real source material to build 7-9
  // dense blocks. When absent (older clips), fall back to summary +
  // keyPoints — the agent still produces a minimal infographic.
  const hasPageContent = input.pageContent.length > 0;
  const promptLines: string[] = [
    '[infographic-mode]',
    '请基于以下已剪藏的卡片内容，生成一张海报式信息图（{ "version": 1, "blocks": [...] }）。',
    '不要 WebFetch / WebSearch，只用下方提供的内容。',
    hasPageContent
      ? '卡片包含 `## 正文`（curl.md 抓取的页面 Markdown 全文），请基于正文提炼 7-9 个信息密集的 block。'
      : '卡片无 `## 正文`（旧剪藏），仅基于摘要与要点生成信息图（可少于 7 个 block）。',
    '',
    `title: ${input.title}`,
    `url: ${input.url}`,
    input.hostname ? `hostname: ${input.hostname}` : '',
    '',
    '## 摘要',
    input.summary || '（无摘要）',
    '',
    '## 要点',
    keyPointsBlock,
  ];
  if (hasPageContent) {
    // Soft cap to avoid blowing the prompt budget; the agent summarizes
    // beyond this. ~12k chars is well within Claude's context window while
    // leaving room for the output blocks.
    const body = input.pageContent.length > 12000
      ? input.pageContent.slice(0, 12000) + '\n\n…（正文过长，已截断）'
      : input.pageContent;
    promptLines.push('', '## 正文', body);
  }
  const prompt = promptLines.filter((l) => l !== '').join('\n');

  const textPromise = collectTextFromStream(adapter, input.onStream, input.onEvent);
  await adapter.send(prompt, await getFeatureAgentSendOptions('clips'));
  const aiText = await textPromise;

  const jsonStr = extractJsonObject(aiText);
  if (!jsonStr) {
    throw new Error('AI 返回的内容无法解析为信息图 JSON');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error('AI 返回的内容无法解析为信息图 JSON');
  }
  const normalized = normalizeInfographicDoc(parsed);
  if (!normalized) {
    throw new Error('AI 返回的信息图 JSON 形状不合法（需为 { version, blocks: [...] }）');
  }
  return normalized;
}

/**
 * Phase 2: Assemble the markdown file and save to disk.
 * The metadata may have been modified by the user (e.g. edited tags/title).
 * If `infographic` is provided, it's written under a `## 信息图` section at
 * the TOP position (right after the `> **来源**` quote line, before
 * `## 摘要`). If `infographic` is null, the section is omitted.
 *
 * If overwritePath is provided, overwrite the existing file at that path.
 *
 * Pass `{ skipAutoOpen: true }` to suppress auto-opening the saved file in
 * the editor — used by the batch clip path so a batch run doesn't open N tabs.
 */
export async function saveClip(
  payload: { metadata: ClipMetadata; infographic?: InfographicDoc | null } | ClipMetadata,
  overwritePath?: string,
  options?: { skipAutoOpen?: boolean },
): Promise<string> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  // Accept both the new `{ metadata, infographic }` shape and a bare
  // `ClipMetadata` for backward compatibility with callers that haven't
  // been migrated yet (e.g. legacy tests / external callers).
  const metadata: ClipMetadata = 'metadata' in payload && payload.metadata
    ? payload.metadata
    : (payload as ClipMetadata);
  const infographic: InfographicDoc | null =
    'metadata' in payload ? (payload.infographic ?? null) : null;

  const tagsStr = metadata.tags.map((t) => `"${t}"`).join(', ');
  const date = new Date().toISOString().split('T')[0];
  const slug = toSlug(metadata.title);

  const keyPointsSection = metadata.keyPoints.length > 0
    ? metadata.keyPoints.map((p) => `- ${p}`).join('\n')
    : '_无要点提取_';

  const hostname = (() => { try { return new URL(metadata.url).hostname; } catch { return metadata.url; } })();

  // Section order: front-matter → `> **来源**` quote → ## 信息图 (if present,
  // TOP position) → ## 摘要 → ## 要点 → ## 正文 (if present).
  const sections: string[] = [
    '---',
    `title: "${metadata.title}"`,
    'type: clip',
    `url: "${metadata.url}"`,
    `tags: [${tagsStr}]`,
    `clipped: ${date}`,
    '---',
    '',
    `> **来源**: [${hostname}](${metadata.url})`,
    '',
  ];

  if (infographic) {
    sections.push(serializeInfographicSection(infographic), '');
  }

  sections.push(
    '## 摘要',
    '',
    metadata.summary,
    '',
    '## 要点',
    '',
    keyPointsSection,
    '',
  );

  // Only write `## 正文` when the agent returned page content. Older clips
  // (and any caller that doesn't supply `pageContent`) simply omit the
  // section; a future re-clip can populate it.
  if (metadata.pageContent) {
    sections.push('## 正文', '', metadata.pageContent, '');
  }

  const fileContent = sections.join('\n');

  let filePath: string;
  if (overwritePath) {
    // Overwrite the existing clip at its current path
    filePath = overwritePath;
    await vault.writeFile(filePath, fileContent);
  } else {
    // Determine primary tag directory and create new file
    const primaryTag = metadata.tags.length > 0 ? metadata.tags[0] : '未分类';
    const tagDir = `__clips__/${primaryTag}`;

    // Ensure directory exists
    await useVaultStore.getState().createDir(tagDir);

    const fileName = `${date}-${slug}.md`;
    filePath = `${tagDir}/${fileName}`;

    await vault.createFile(filePath, fileContent);
  }

  // Auto-open in editor (unless suppressed, e.g. during batch clipping)
  if (!options?.skipAutoOpen) {
    const fileName = filePath.split('/').pop() || filePath;
    await editorIoService.openFile(filePath, fileName);
  }

  return filePath;
}

/**
 * Backward-compatible wrapper: AI generate + save in one step.
 * Used by /clip command in AiPanel and WebViewer "clip this page" button.
 * If overwritePath is provided, the saved file overwrites the existing clip
 * at that path (force re-clip path).
 */
export async function clipUrl(
  url: string,
  onProgress?: (msg: string) => void,
  lang: ClipLanguage = 'auto',
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
  overwritePath?: string,
): Promise<string> {
  const { metadata, infographic } = await generateClip(url, onProgress, lang, onStream, onEvent);
  onProgress?.('正在保存文件...');
  return saveClip({ metadata, infographic }, overwritePath);
}
