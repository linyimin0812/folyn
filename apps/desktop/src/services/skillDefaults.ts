import type { Skill } from '@/types/skill';

/**
 * Built-in skill defaults.
 * These are the source of truth for skill definitions.
 * Each skill's `content` is a Markdown document sent to Claude Code as instructions.
 */

const clipCardSkill: Skill = {
  id: 'clip-card',
  name: '网页剪藏卡片',
  description: '分析网页内容生成结构化知识卡片',
  version: '1.0.0',
  builtin: true,
  content: `# Web Clip Card Generation

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
- 所有输出内容使用与网页内容相同的语言`,
};

const githubAnalysisSkill: Skill = {
  id: 'github-analysis',
  name: 'GitHub 项目分析',
  description: '深度分析 GitHub 仓库并生成 HTML 报告',
  version: '1.0.0',
  builtin: true,
  content: `# GitHub Repository Analysis

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
- If the README is in English, write the report in English`,
};

/** All built-in skill defaults, keyed by skill ID. */
export const builtinSkills: Record<string, Skill> = {
  [clipCardSkill.id]: clipCardSkill,
  [githubAnalysisSkill.id]: githubAnalysisSkill,
};
