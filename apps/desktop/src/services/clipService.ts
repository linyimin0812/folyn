import { CliAdapterRegistry } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { collectTextFromStream } from './aiStreamUtils';

export type ClipLanguage = 'en' | 'zh' | 'auto';

interface ClipCard {
  title: string;
  tags: string[];
  suggestedTags: string[];
  summary: string;
  keyPoints: string[];
}

/** Metadata returned by generateClip, consumed by saveClip */
export interface ClipMetadata {
  title: string;
  tags: string[];
  suggestedTags: string[];
  summary: string;
  keyPoints: string[];
  url: string;
  /** Raw markdown fetched from the page (needed to assemble the file) */
  markdown: string;
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'clip';
}

async function fetchMarkdown(url: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const content = await invoke<string>('fetch_url_content', { url });
  return content;
}

function getLanguageInstruction(lang: ClipLanguage): string {
  switch (lang) {
    case 'zh': return '【重要】所有输出内容（标题、标签、摘要、要点）必须使用中文。';
    case 'en': return '【重要】All output content (title, tags, summary, key points) MUST be in English.';
    case 'auto': return '请使用与网页内容相同的语言生成标题、标签、摘要和要点。';
  }
}

function buildCardPrompt(content: string, url: string, lang: ClipLanguage = 'auto'): string {
  const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...(内容已截断)' : content;
  return `你是一个网页内容分析助手。请分析以下网页内容，生成一张结构化的知识卡片。

## URL
${url}

## 网页内容（Markdown 格式）
${truncated}

## 要求
请以 JSON 格式回复（不要使用 markdown 代码块包裹）：
{
  "title": "page title here",
  "tags": ["tag1", "tag2", "tag3"],
  "suggestedTags": ["tag4", "tag5", "tag6", "tag7", "tag8"],
  "summary": "2-4 sentences summarizing core content",
  "keyPoints": [
    "key point 1: one sentence describing key information",
    "key point 2: one sentence describing key information",
    "key point 3: one sentence describing key information"
  ]
}

规则：
- ${getLanguageInstruction(lang)}
- tags 字段生成恰好 3-5 个简洁的关键词标签
- suggestedTags 字段额外提供 5-8 个候选标签，供用户选择添加
- 摘要概括核心内容，2-4句话
- 要点提取3-8条最重要的信息，每条一句话`;
}

function buildFallbackCard(url: string, markdown: string): ClipCard {
  let hostname = 'Untitled';
  try { hostname = new URL(url).hostname; } catch {}
  const preview = markdown.slice(0, 300);
  // Extract first few sentences as key points
  const sentences = preview.match(/[^。.!?\n]+[。.!?\n]?/g)?.slice(0, 5) || [preview];
  return {
    title: hostname,
    tags: [],
    suggestedTags: [],
    summary: preview.slice(0, 200) + (preview.length > 200 ? '...' : ''),
    keyPoints: sentences.map((s) => s.trim()).filter(Boolean),
  };
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
 * Phase 1: Fetch page content and generate metadata via AI.
 * Does NOT save to disk — returns the metadata for user confirmation.
 */
export async function generateClip(
  url: string,
  onProgress?: (msg: string) => void,
  lang: ClipLanguage = 'auto',
): Promise<ClipMetadata> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');
  validateUrl(url);

  // Step 1: Fetch content
  onProgress?.('正在获取页面内容...');
  let markdown: string;
  try {
    markdown = await fetchMarkdown(url);
  } catch (err) {
    throw new Error(`获取页面内容失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!markdown || markdown.trim().length === 0) {
    throw new Error('页面内容为空或无法转换为 Markdown');
  }

  // Step 2: AI generate card content
  onProgress?.('正在生成知识卡片...');
  const settings = useSettingsStore.getState();
  let basePath = vault.currentVault.basePath;
  if (basePath.startsWith('~')) {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/\/+$/, '');
    basePath = home + basePath.slice(1);
  }

  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(settings.cliAdapter);
  await adapter.start({ cliPath: settings.cliPath, workingDir: basePath });

  let card: ClipCard;
  try {
    const prompt = buildCardPrompt(markdown, url, lang);
    const textPromise = collectTextFromStream(adapter);
    await adapter.send(prompt);
    const aiText = await textPromise;

    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
      card = {
        title: parsed.title || 'Untitled',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : [],
        summary: parsed.summary || '',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      };
    } catch {
      card = buildFallbackCard(url, markdown);
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
    url,
    markdown,
  };
}

/**
 * Phase 2: Assemble the markdown file and save to disk.
 * The metadata may have been modified by the user (e.g. edited tags/title).
 * If overwritePath is provided, overwrite the existing file at that path.
 */
export async function saveClip(metadata: ClipMetadata, overwritePath?: string): Promise<string> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  const tagsStr = metadata.tags.map((t) => `"${t}"`).join(', ');
  const date = new Date().toISOString().split('T')[0];
  const slug = toSlug(metadata.title);

  const keyPointsSection = metadata.keyPoints.length > 0
    ? metadata.keyPoints.map((p) => `- ${p}`).join('\n')
    : '_无要点提取_';

  const hostname = (() => { try { return new URL(metadata.url).hostname; } catch { return metadata.url; } })();

  const fileContent = [
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
  ].join('\n');

  let filePath: string;
  if (overwritePath) {
    // Overwrite the existing clip at its current path
    filePath = overwritePath;
    await vault.writeFile(filePath, fileContent);
  } else {
    // Determine primary tag directory and create new file
    const primaryTag = metadata.tags.length > 0 ? metadata.tags[0] : '未分类';
    const tagDir = `clips/${primaryTag}`;

    // Ensure directory exists
    await useVaultStore.getState().createDir(tagDir);

    const fileName = `${date}-${slug}.md`;
    filePath = `${tagDir}/${fileName}`;

    await vault.createFile(filePath, fileContent);
  }

  // Auto-open in editor
  const fileName = filePath.split('/').pop() || filePath;
  await useEditorStore.getState().openFile(filePath, fileName);

  return filePath;
}

/**
 * Backward-compatible wrapper: fetch + AI generate + save in one step.
 * Used by /clip command in AiPanel and WebViewer "clip this page" button.
 */
export async function clipUrl(
  url: string,
  onProgress?: (msg: string) => void,
  lang: ClipLanguage = 'auto',
): Promise<string> {
  const metadata = await generateClip(url, onProgress, lang);
  onProgress?.('正在保存文件...');
  return saveClip(metadata);
}
