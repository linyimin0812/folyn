import { CliAdapterRegistry } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSkillStore } from '@/store/skillStore';
import { collectTextFromStream, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';
import { getFeatureAgentSendOptions } from './featureAgentService';
import {
  parseClipContent,
  writeInfographicSection,
  normalizeInfographicDoc,
  type InfographicDoc,
  type InfographicBlock,
} from '@/features/clips/clipParse';

export type ClipLanguage = 'en' | 'zh' | 'auto';

// Re-export infographic types so callers can import everything from clipService.
export type { InfographicDoc, InfographicBlock };

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

export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'clip';
}

function validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('invalid protocol');
    }
  } catch {
    throw new Error('无效的网址，请输入以 http:// 或 https:// 开头的链接');
  }
}

/**
 * Phase 1: Generate metadata via AI.
 * Claude Code handles fetching the URL content via its own tools.
 * Does NOT save to disk — returns the metadata for user confirmation.
 */
export async function generateClip(
  url: string,
  onProgress?: (msg: string) => void,
  _lang: ClipLanguage = 'auto',
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<ClipMetadata> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');
  validateUrl(url);

  onProgress?.('AI 正在分析网页...');
  const settings = useSettingsStore.getState();
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // clips agent cwd = `<vault>/__clips__/`：agent 自动发现 `.claude/agents/clips.md`。
  const workingDir = `${basePath.replace(/\/+$/, '')}/__clips__`;

  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(settings.cliAdapter);
  await adapter.start({ cliPath: settings.cliPath, workingDir });

  let card: ClipCard;
  try {
    // curl.md service: GET https://curl.md/<encoded original URL> → optimized Markdown.
    // The agent WebFetches this curl.md URL (not the raw page URL) to get the page
    // content already converted to Markdown. The original URL is still conveyed for
    // title / source context.
    const mdUrl = 'https://curl.md/' + encodeURIComponent(url);
    const skill = useSkillStore.getState().getSkillForCapability('clip');
    const prompt = skill
      ? `${skill.content}\n\n## Task\n请分析以下网页并生成知识卡片元数据。\n原始 URL（仅作来源/标题参考）：${url}\n用 WebFetch 抓取 curl.md 版本：${mdUrl}`
      : `请分析以下网页并生成知识卡片元数据。\n原始 URL（仅作来源/标题参考）：${url}\n用 WebFetch 抓取 curl.md 版本：${mdUrl}`;

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
      throw new Error('AI 返回的内容无法解析为知识卡片，请检查 SKILL 配置');
    }
  } finally {
    await adapter.stop();
  }

  return {
    title: card.title,
    tags: card.tags,
    suggestedTags: card.suggestedTags,
    summary: card.summary,
    keyPoints: card.keyPoints,
    pageContent: card.pageContent,
    url,
  };
}

/**
 * Phase 2: Assemble the markdown file and save to disk.
 * The metadata may have been modified by the user (e.g. edited tags/title).
 * If overwritePath is provided, overwrite the existing file at that path.
 *
 * Pass `{ skipAutoOpen: true }` to suppress auto-opening the saved file in
 * the editor — used by the batch clip path so a batch run doesn't open N tabs.
 */
export async function saveClip(
  metadata: ClipMetadata,
  overwritePath?: string,
  options?: { skipAutoOpen?: boolean },
): Promise<string> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  const tagsStr = metadata.tags.map((t) => `"${t}"`).join(', ');
  const date = new Date().toISOString().split('T')[0];
  const slug = toSlug(metadata.title);

  const keyPointsSection = metadata.keyPoints.length > 0
    ? metadata.keyPoints.map((p) => `- ${p}`).join('\n')
    : '_无要点提取_';

  const hostname = (() => { try { return new URL(metadata.url).hostname; } catch { return metadata.url; } })();

  // Section order: front-matter → `> **来源**` quote → ## 摘要 → ## 要点
  // → ## 正文 (if present). `## 信息图` is NOT written here — it's generated
  // on-demand by `generateInfographic`, which writes it at the TOP position
  // (right after the quote line, before `## 摘要`).
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
    '## 摘要',
    '',
    metadata.summary,
    '',
    '## 要点',
    '',
    keyPointsSection,
    '',
  ];

  // Only write `## 正文` when the agent returned page content. Older clips
  // (and any caller that doesn't supply `pageContent`) simply omit the
  // section; the infographic agent falls back to summary + keyPoints.
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
    await useEditorStore.getState().openFile(filePath, fileName);
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
  const metadata = await generateClip(url, onProgress, lang, onStream, onEvent);
  onProgress?.('正在保存文件...');
  return saveClip(metadata, overwritePath);
}

/**
 * Defensive JSON extractor: pull the first `{ ... }` object out of an AI
 * response that may be wrapped in prose or code fences. Shared by
 * `generateClip` (card metadata) and `generateInfographic` so the same
 * extraction discipline applies to both agent modes.
 *
 * Returns the raw JSON string slice, or null if no object-shaped substring is
 * found. Callers `JSON.parse` the result and handle parse errors themselves.
 */
function extractJsonObject(aiText: string): string | null {
  const match = aiText.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

/**
 * On-demand infographic generation for an existing clip file.
 *
 * Reads the clip markdown → parses title/url/summary/keyPoints → invokes the
 * clips agent in `[infographic-mode]` (no WebFetch — content is taken from
 * the already-clipped file) → defensive JSON parse → writes the result back
 * under a `## 信息图` fenced-JSON section, replacing any existing one
 * (regenerate semantics). The rest of the file is preserved byte-for-byte.
 *
 * Returns the parsed `InfographicDoc`. Throws on read/agent/write failures;
 * the caller (clipStore) is responsible for surfacing `infographicError`
 * without clobbering the existing card content.
 */
export async function generateInfographic(
  filePath: string,
  onProgress?: (msg: string) => void,
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<InfographicDoc> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  // 1. Read + parse the existing clip file.
  onProgress?.('正在读取剪藏文件...');
  let content: string;
  try {
    content = await vault.readFile(filePath);
  } catch (err) {
    throw new Error(`读取剪藏文件失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  const clip = parseClipContent(content);
  if (!clip.url && !clip.summary && clip.keyPoints.length === 0) {
    throw new Error('剪藏文件内容为空，无法生成信息图');
  }

  // 2. Build the infographic-mode instruction. The agent must NOT WebFetch —
  //    all needed content (title/url/summary/keyPoints) is embedded here.
  onProgress?.('AI 正在生成信息图...');
  const settings = useSettingsStore.getState();
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  const workingDir = `${basePath.replace(/\/+$/, '')}/__clips__`;

  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(settings.cliAdapter);
  await adapter.start({ cliPath: settings.cliPath, workingDir });

  let doc: InfographicDoc;
  try {
    const keyPointsBlock = clip.keyPoints.length > 0
      ? clip.keyPoints.map((p) => `- ${p}`).join('\n')
      : '（无要点）';
    // Build the prompt. When `## 正文` (full page markdown from curl.md) is
    // present, pass it so the agent has real source material to build 7-9
    // dense blocks. When absent (older clips), fall back to summary +
    // keyPoints — the agent still produces a minimal infographic.
    const hasPageContent = clip.pageContent.length > 0;
    const promptLines: string[] = [
      '[infographic-mode]',
      '请基于以下已剪藏的卡片内容，生成一张海报式信息图（{ "version": 1, "blocks": [...] }）。',
      '不要 WebFetch / WebSearch，只用下方提供的内容。',
      hasPageContent
        ? '卡片包含 `## 正文`（curl.md 抓取的页面 Markdown 全文），请基于正文提炼 7-9 个信息密集的 block。'
        : '卡片无 `## 正文`（旧剪藏），仅基于摘要与要点生成信息图（可少于 7 个 block）。',
      '',
      `title: ${clip.title}`,
      `url: ${clip.url}`,
      clip.hostname ? `hostname: ${clip.hostname}` : '',
      clip.clipped ? `clipped: ${clip.clipped}` : '',
      '',
      '## 摘要',
      clip.summary || '（无摘要）',
      '',
      '## 要点',
      keyPointsBlock,
    ];
    if (hasPageContent) {
      // Soft cap to avoid blowing the prompt budget; the agent summarizes
      // beyond this. ~12k chars is well within Claude's context window while
      // leaving room for the output blocks.
      const body = clip.pageContent.length > 12000
        ? clip.pageContent.slice(0, 12000) + '\n\n…（正文过长，已截断）'
        : clip.pageContent;
      promptLines.push('', '## 正文', body);
    }
    const prompt = promptLines.filter((l) => l !== '').join('\n');

    const textPromise = collectTextFromStream(adapter, onStream, onEvent);
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
    doc = normalized;
  } finally {
    await adapter.stop();
  }

  // 3. Write back: replace (or append) the `## 信息图` section, preserve the rest.
  onProgress?.('正在写入信息图...');
  const newContent = writeInfographicSection(content, doc);
  await vault.writeFile(filePath, newContent);

  return doc;
}
