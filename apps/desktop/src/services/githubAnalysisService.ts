import { createAdapter } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import * as editorIoService from '@/services/editorIoService';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { collectTextFromStream, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';
import { getFeatureAgentSendOptions } from './featureAgentService';

export type ReportLanguage = 'zh' | 'en' | 'auto';

// ponytail: prompt previously lived in services/skillDefaults.ts and was
// overridable via the Skills settings page. After removing that page the
// template is inlined here as the single source of truth.
const GITHUB_ANALYSIS_PROMPT = `# GitHub Repository Analysis

You are a senior software architect. Analyze a GitHub repository and generate a comprehensive HTML report.

## Important Rules
- **Do NOT use Write or any file creation tool to save the HTML report to disk.** The application will handle saving automatically.
- Only output the report content in your response text (inside a code block as specified below).
- Clone repos to \`/tmp/\` only, and clean up after analysis.

## Steps

1. **Clone the repository**: Use Bash to run \`git clone --depth 1 <repo_url> /tmp/quill-repo-<reponame>\` to clone the repo locally
2. **Explore the project structure**:
   - Use Bash to list the directory tree (depth 3, max 500 lines)
   - Use Read to examine package manifests (package.json, Cargo.toml, go.mod, pyproject.toml, requirements.txt, etc.)
   - Use Read to examine configuration files (tsconfig.json, .eslintrc, webpack.config, etc.)
   - Use Read to examine the README file
   - Use Read to examine main entry points and 3-5 core source files
3. **Generate an HTML analysis report** with these sections:
   - **Project Overview**: What the project does, its purpose, target audience
   - **Tech Stack Analysis**: Languages, frameworks, key dependencies — with a visual language distribution bar
   - **Code Structure Analysis**: Architecture pattern, directory organization, design decisions
   - **Key Module Analysis**: Deep dive into 3-5 most important modules/components
   - **Code Quality & Standards**: Code style, testing coverage, documentation quality, CI/CD
   - **Pros & Cons**: Strengths and weaknesses assessment
   - **Summary & Recommendations**: Overall rating, recommendations for improvement
4. **Clean up**: Use Bash to remove the cloned repo directory \`rm -rf /tmp/quill-repo-<reponame>\`

## HTML Report Requirements
- Self-contained single HTML file with inline CSS (no external dependencies)
- Professional, modern design with CSS custom properties for theming
- Card-based layout for each section
- Language distribution bar chart (pure CSS, colored segments)
- Responsive design
- Color scheme: light background (#f8f9fa), accent blue (#3b82f6), dark text (#1e293b)
- Header with project name, GitHub link, and analysis date
- Monospace font for code references

## Output Format

First output the tags block, then the HTML code block. No other text.

Example:
---TAGS---
["react", "typescript", "frontend", "web-app"]
---END---

\`\`\`html
<!DOCTYPE html>
<html>
...
</html>
\`\`\`

## Language
- Use the same language as the repository's README for the report content
- If the README is in Chinese, write the report in Chinese
- If the README is in English, write the report in English`;

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
    const prompt = `${GITHUB_ANALYSIS_PROMPT}\n\n## Task\n请分析以下 GitHub 仓库并生成 HTML 报告：\n${url}\n报告语言: ${language === 'auto' ? 'auto-detect from README' : language}`;

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
