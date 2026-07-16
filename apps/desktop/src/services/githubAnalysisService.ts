import { createAdapter } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import * as editorIoService from '@/services/editorIoService';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useSkillStore } from '@/store/skillStore';
import { collectTextFromStream, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';
import { getFeatureAgentSendOptions } from './featureAgentService';

export type ReportLanguage = 'zh' | 'en' | 'auto';

/**
 * Parse a GitHub URL into owner and repo components.
 * Handles various formats: https, git@, trailing slashes, .git suffix.
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');

  // Handle SSH format: git@github.com:owner/repo
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+)$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // Handle HTTPS format: https://github.com/owner/repo
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new Error('无效的 GitHub 仓库链接，请输入格式如 https://github.com/owner/repo');
}

/**
 * Extract tags and HTML content from an AI response.
 * Expected format:
 * ---TAGS---
 * ["tag1", "tag2"]
 * ---END---
 * ```html
 * ...
 * ```
 */
function extractTagsAndHtml(aiResponse: string): { tags: string[]; html: string } {
  let tags: string[] = [];
  let html: string = '';

  // Try to extract tags block
  const tagsMatch = aiResponse.match(/---TAGS---\s*\n([\s\S]*?)\n---END---/);
  if (tagsMatch) {
    try {
      const parsed = JSON.parse(tagsMatch[1].trim());
      if (Array.isArray(parsed)) {
        tags = parsed.map((t) => String(t).toLowerCase().trim()).filter(Boolean);
      }
    } catch {
      console.warn('[githubAnalysisService] Failed to parse tags JSON:', tagsMatch[1]);
    }
  }

  // Extract HTML from code block or raw HTML
  const trimmedResponse = aiResponse.replace(/---TAGS---[\s\S]*?---END---/, '').trim();

  // Try to extract from ```html ... ``` code block
  const htmlMatch = trimmedResponse.match(/```html\s*\n([\s\S]*?)\n```/);
  if (htmlMatch) {
    html = htmlMatch[1].trim();
  } else {
    // Try generic code block
    const codeMatch = trimmedResponse.match(/```\s*\n([\s\S]*?)\n```/);
    if (codeMatch) {
      html = codeMatch[1].trim();
    } else if (trimmedResponse.startsWith('<!DOCTYPE') || trimmedResponse.startsWith('<html')) {
      html = trimmedResponse;
    } else {
      html = trimmedResponse;
    }
  }

  return { tags, html };
}

/**
 * Result of the generate phase — no files saved yet.
 */
export interface GeneratedReport {
  tags: string[];
  html: string;
  repo: string;
}

/**
 * Phase 1: Analyze repo with AI, return tags + HTML without saving.
 * Claude Code handles cloning, reading files, and analyzing via its own tools.
 *
 * @param url - GitHub repository URL
 * @param language - Report language preference
 * @param onProgress - Optional callback for progress updates
 * @returns Generated report data (tags, html, repo name)
 */
export async function generateReport(
  url: string,
  language: ReportLanguage,
  onProgress?: (msg: string) => void,
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<GeneratedReport> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('请先打开一个 Vault');

  // 1. Parse URL (just for extracting repo name)
  onProgress?.('解析仓库链接...');
  const { repo } = parseGitHubUrl(url);

  // 2. AI analysis — Claude Code handles cloning, reading, analyzing
  onProgress?.('AI 正在深度分析...');
  const aiConfig = useAiConfigStore.getState();
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // analyze agent cwd = `<vault>/__analyze__/`：agent 自动发现 `.claude/agents/analyze.md`。
  const workingDir = `${basePath.replace(/\/+$/, '')}/__analyze__`;

  const adapter = createAdapter(aiConfig.cliAdapter);
  await adapter.start({ cliPath: aiConfig.cliPath, workingDir });

  let aiResponse: string;
  try {
    const skill = useSkillStore.getState().getSkillForCapability('github-analysis');
    const prompt = skill
      ? `${skill.content}\n\n## Task\n请分析以下 GitHub 仓库并生成 HTML 报告：\n${url}\n报告语言: ${language === 'auto' ? 'auto-detect from README' : language}`
      : `You are a senior software architect. Analyze this GitHub repository and generate a comprehensive HTML analysis report.\n\nRepository: ${url}\nLanguage: ${language}\n\nClone the repo, explore the source code, and generate a self-contained HTML report with tags.\n\nOutput format:\n---TAGS---\n["tag1", "tag2"]\n---END---\n\n\`\`\`html\n<!DOCTYPE html>...\n\`\`\``;

    const textPromise = collectTextFromStream(adapter, onStream, onEvent);
    await adapter.send(prompt, await getFeatureAgentSendOptions('analyze'));
    aiResponse = await textPromise;
  } finally {
    await adapter.stop();
  }

  if (!aiResponse || aiResponse.trim().length === 0) {
    throw new Error('AI 分析结果为空');
  }

  // 3. Extract tags and HTML from AI response
  const { tags, html: htmlContent } = extractTagsAndHtml(aiResponse);

  if (!htmlContent.startsWith('<!DOCTYPE') && !htmlContent.startsWith('<html')) {
    throw new Error('AI 未能生成有效的 HTML 报告');
  }

  return { tags, html: htmlContent, repo };
}

/**
 * Phase 2: Save a generated report (HTML + tags sidecar) to the vault.
 *
 * @param repo - Repository name (used for filename)
 * @param tags - Tags to save in sidecar
 * @param html - HTML content to save
 * @returns The vault-relative path of the saved report file
 */
export async function saveReport(
  repo: string,
  tags: string[],
  html: string,
): Promise<string> {
  const vault = useVaultStore.getState();

  const date = new Date().toISOString().split('T')[0];
  const fileName = `${date}-${repo}.html`;
  const filePath = `__reports__/${fileName}`;

  await vault.createDir('__reports__');
  await vault.createFile(filePath, html);

  // Save tags sidecar file
  if (tags.length > 0) {
    const sidecarPath = filePath.replace(/\.html$/, '.tags.json');
    await vault.createFile(sidecarPath, JSON.stringify({ tags }, null, 2));
  }

  // Auto-open in editor
  await editorIoService.openFile(filePath, fileName);

  return filePath;
}

/**
 * Main pipeline: analyze with AI, save HTML report.
 * Backward-compatible wrapper that calls generateReport + saveReport.
 *
 * @param url - GitHub repository URL
 * @param language - Report language preference
 * @param onProgress - Optional callback for progress updates
 * @returns The vault-relative path of the saved report file
 */
export async function analyzeProject(
  url: string,
  language: ReportLanguage,
  onProgress?: (msg: string) => void,
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<string> {
  onProgress?.('正在保存报告...');
  const { tags, html, repo } = await generateReport(url, language, onProgress, onStream, onEvent);
  return saveReport(repo, tags, html);
}
