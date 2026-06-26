import { CliAdapterRegistry } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSkillStore } from '@/store/skillStore';
import { collectTextFromStream, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';

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
}

function toSlug(title: string): string {
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

  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(settings.cliAdapter);
  await adapter.start({ cliPath: settings.cliPath, workingDir: basePath });

  let card: ClipCard;
  try {
    const skill = useSkillStore.getState().getSkillForCapability('clip');
    const prompt = skill
      ? `${skill.content}\n\n## Task\n请分析以下网页并生成知识卡片：\n${url}`
      : `你是一个网页内容分析助手。请分析以下网页内容，生成一张结构化的知识卡片。\n\nURL: ${url}\n\n请以 JSON 格式回复：\n{\n  "title": "page title",\n  "tags": ["tag1", "tag2", "tag3"],\n  "suggestedTags": ["tag4", "tag5"],\n  "summary": "2-4 sentences summary",\n  "keyPoints": ["point 1", "point 2", "point 3"]\n}`;

    const textPromise = collectTextFromStream(adapter, onStream, onEvent);
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
    url,
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
    const tagDir = `__clips__/${primaryTag}`;

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
 * Backward-compatible wrapper: AI generate + save in one step.
 * Used by /clip command in AiPanel and WebViewer "clip this page" button.
 */
export async function clipUrl(
  url: string,
  onProgress?: (msg: string) => void,
  lang: ClipLanguage = 'auto',
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<string> {
  const metadata = await generateClip(url, onProgress, lang, onStream, onEvent);
  onProgress?.('正在保存文件...');
  return saveClip(metadata);
}
