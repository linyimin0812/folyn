import { CliAdapterRegistry } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { collectTextFromStream } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';

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
 * Clone a GitHub repository to a local directory using Tauri shell command.
 * Performs a shallow clone (--depth 1) for speed.
 * Retries with alternate URL format on failure.
 */
async function cloneRepo(owner: string, repo: string, targetDir: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const urls = [
    `https://github.com/${owner}/${repo}.git`,
    `https://github.com/${owner}/${repo}`,
  ];

  let lastError: string = '';
  for (const url of urls) {
    try {
      await invoke<string>('git_clone', { url, targetDir });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(lastError || '克隆失败');
}

/**
 * Get a text overview of a project directory structure.
 * Returns file tree listing (limited to 500 lines, depth 3).
 */
async function getProjectOverview(cloneDir: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('get_project_overview', { dir: cloneDir });
}

/**
 * Detect the primary language of a text using CJK character ratio.
 * Returns 'zh' if CJK characters are significant, 'en' otherwise.
 */
export function detectLanguage(readme: string): 'zh' | 'en' {
  if (!readme || readme.length === 0) return 'en';
  // Count CJK characters (Chinese, Japanese, Korean)
  const cjkMatch = readme.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  const cjkCount = cjkMatch ? cjkMatch.length : 0;
  // If more than 5% of characters are CJK, consider it Chinese
  return cjkCount / readme.length > 0.05 ? 'zh' : 'en';
}

/**
 * Build the AI analysis prompt for generating an HTML report.
 */
function buildAnalysisPrompt(
  projectOverview: string,
  readmeContent: string,
  language: 'zh' | 'en',
): string {
  const isZh = language === 'zh';

  const langInstruction = isZh
    ? '【重要】报告的所有内容必须使用中文撰写，包括标题、正文、分析文字。'
    : '【IMPORTANT】The entire report MUST be written in English, including titles, body text, and analysis.';

  const sectionNames = isZh
    ? {
        overview: '项目概况',
        techStack: '技术栈分析',
        structure: '代码结构分析',
        modules: '核心模块解读',
        quality: '开发规范与质量',
        prosCons: '项目优劣势',
        summary: '总结与建议',
      }
    : {
        overview: 'Project Overview',
        techStack: 'Tech Stack Analysis',
        structure: 'Code Structure Analysis',
        modules: 'Key Module Analysis',
        quality: 'Code Quality & Standards',
        prosCons: 'Pros & Cons',
        summary: 'Summary & Recommendations',
      };

  return `You are a senior software architect analyzing a GitHub project. Generate a comprehensive, self-contained HTML analysis report.

${langInstruction}

## Project File Tree
\`\`\`
${projectOverview}
\`\`\`

## README Content
${readmeContent ? readmeContent.slice(0, 6000) : '(No README found)'}

## Instructions

1. **Explore the project**: Use your Read tool to examine key files for deeper analysis. Prioritize:
   - Package manifests (package.json, Cargo.toml, go.mod, pyproject.toml, requirements.txt, etc.)
   - Configuration files (tsconfig.json, .eslintrc, webpack.config, etc.)
   - Main entry points and core source files
   - Test configuration and examples

2. **Generate an HTML report** with the following sections:
   - **${sectionNames.overview}**: What the project does, its purpose, target audience
   - **${sectionNames.techStack}**: Languages, frameworks, key dependencies — with a visual language distribution bar
   - **${sectionNames.structure}**: Architecture pattern, directory organization, design decisions
   - **${sectionNames.modules}**: Deep dive into 3-5 most important modules/components
   - **${sectionNames.quality}**: Code style, testing coverage, documentation quality, CI/CD
   - **${sectionNames.prosCons}**: Strengths and weaknesses assessment
   - **${sectionNames.summary}**: Overall rating, recommendations for improvement

3. **HTML Report Requirements**:
   - Self-contained single HTML file with inline CSS (no external dependencies)
   - Professional, modern design with CSS custom properties for theming
   - Card-based layout for each section
   - Language distribution bar chart (pure CSS, colored segments)
   - Responsive design (readable on different widths)
   - Use a clean color scheme: light background (#f8f9fa), accent blue (#3b82f6), dark text (#1e293b)
   - Include a header with project name, GitHub link, and analysis date
   - Use monospace font for code references
   - Section cards should have subtle shadows, rounded corners, and clear headings

4. **Generate Tags**: Before the HTML, output 3-5 concise tags that describe the project's main technologies and domains. Tags should be lowercase (e.g., "react", "typescript", "machine-learning", "cli-tool").

5. Output format: First output the tags block, then the HTML code block. No other text before or after.

Example output:
---TAGS---
["react", "typescript", "frontend", "web-app"]
---END---

\`\`\`html
<!DOCTYPE html>
<html>
...
</html>
\`\`\``;
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
 * Read a README file from the cloned repository directory.
 * Tries common README file names in order of priority.
 */
async function readReadme(cloneDir: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  const readmeNames = ['README.md', 'readme.md', 'README.rst', 'README.txt', 'README'];

  for (const name of readmeNames) {
    try {
      const content = await invoke<string>('open_file', { path: `${cloneDir}/${name}` });
      if (content && content.trim().length > 0) return content;
    } catch {
      // Try next name
    }
  }
  return '';
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
 * Phase 1: Clone repo, analyze with AI, return tags + HTML without saving.
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
): Promise<GeneratedReport> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('请先打开一个 Vault');

  // 1. Parse URL
  onProgress?.('解析仓库链接...');
  const { owner, repo } = parseGitHubUrl(url);

  // 2. Resolve base path and set up clone directory
  onProgress?.('正在克隆仓库...');
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  const reposDir = `${basePath}/.quill-repos`;
  const cloneDir = `${reposDir}/${repo}`;

  // Clone repo (shallow clone) to .quill-repos directory
  try {
    await cloneRepo(owner, repo, cloneDir);
  } catch (err) {
    throw new Error(`克隆仓库失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    // 3. Get project overview (file tree)
    onProgress?.('正在分析项目结构...');
    let projectOverview: string;
    try {
      projectOverview = await getProjectOverview(cloneDir);
    } catch (err) {
      throw new Error(`分析项目结构失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Read README
    const readme = await readReadme(cloneDir);

    // 5. Detect language if auto
    const resolvedLanguage: 'zh' | 'en' =
      language === 'auto' ? detectLanguage(readme) : language;

    // 6. AI analysis
    onProgress?.('AI 正在深度分析...');
    const settings = useSettingsStore.getState();

    const registry = CliAdapterRegistry.getInstance();
    const adapter = registry.create(settings.cliAdapter);
    // Set workingDir to cloneDir so AI can Read files from the cloned repo
    await adapter.start({ cliPath: settings.cliPath, workingDir: cloneDir });

    let aiResponse: string;
    try {
      const prompt = buildAnalysisPrompt(projectOverview, readme, resolvedLanguage);
      const textPromise = collectTextFromStream(adapter);
      await adapter.send(prompt);
      aiResponse = await textPromise;
    } finally {
      await adapter.stop();
    }

    if (!aiResponse || aiResponse.trim().length === 0) {
      throw new Error('AI 分析结果为空');
    }

    // 7. Extract tags and HTML from AI response
    const { tags, html: htmlContent } = extractTagsAndHtml(aiResponse);

    if (!htmlContent.startsWith('<!DOCTYPE') && !htmlContent.startsWith('<html')) {
      throw new Error('AI 未能生成有效的 HTML 报告');
    }

    return { tags, html: htmlContent, repo };
  } finally {
    // Always cleanup cloned repo to avoid disk bloat
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('remove_dir', { path: cloneDir });
    } catch {
      console.warn('[githubAnalysisService] Failed to cleanup cloned repo:', cloneDir);
    }
  }
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
  const filePath = `reports/${fileName}`;

  await vault.createDir('reports');
  await vault.createFile(filePath, html);

  // Save tags sidecar file
  if (tags.length > 0) {
    const sidecarPath = filePath.replace(/\.html$/, '.tags.json');
    await vault.createFile(sidecarPath, JSON.stringify({ tags }, null, 2));
  }

  // Auto-open in editor
  await useEditorStore.getState().openFile(filePath, fileName);

  return filePath;
}

/**
 * Main pipeline: clone repo, analyze with AI, save HTML report.
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
): Promise<string> {
  onProgress?.('正在保存报告...');
  const { tags, html, repo } = await generateReport(url, language, onProgress);
  return saveReport(repo, tags, html);
}
