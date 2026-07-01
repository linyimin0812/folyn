// Study agent：canonical 定义文件（`.claude/agents/study.md`，版本控制）。
//
// canonical agent 文件按功能就近放在 `apps/desktop/src/study/.claude/agents/study.md`，
// 运行时由 featureAgentService 播种到 `<vault>/.claude/agents/study.md`（write-if-missing，
// 不覆盖用户修改），Claude CLI 在 `bare:false` 下靠 cwd 自动发现。
//
// feature agent 调用从 PR2 起改 cwd 发现（runFeatureAgent），不再用 `--agents`
// 内联交付。本模块 `?raw` import canonical 文件，仅解析 front-matter 供单测
// 验证 canonical 契约（research/plan 行语法、feynman/selftest/sq3r callout 格式）。
// 播种取内容由 featureAgentService 直接 `?raw` import，不依赖本模块。

import agentDoc from './.claude/agents/study.md?raw';

export const STUDY_AGENT_NAME = 'study';

export interface StudyAgentDef {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
}

interface ParsedFrontmatter {
  fm: Record<string, string | string[]>;
  body: string;
}

/** 解析 YAML front-matter（仅常用键；逗号分隔值视为数组）。非 .md 库依赖。 */
function parseFrontmatter(doc: string): ParsedFrontmatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(doc);
  if (!m) return { fm: {}, body: doc };
  const fmRaw = m[1];
  const body = m[2];
  const fm: Record<string, string | string[]> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!mm) continue;
    const key = mm[1];
    const val = mm[2].trim();
    if (val.includes(',')) {
      fm[key] = val.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      fm[key] = val;
    }
  }
  return { fm, body };
}

/** 解析 canonical agent 文件为定义对象（纯函数，便于单测验证 canonical 契约）。 */
export function getStudyAgentDef(): StudyAgentDef {
  const { fm, body } = parseFrontmatter(agentDoc);
  const name = typeof fm.name === 'string' && fm.name ? fm.name : STUDY_AGENT_NAME;
  const description = typeof fm.description === 'string' ? fm.description : '';
  const tools = Array.isArray(fm.tools) && fm.tools.length > 0 ? fm.tools : undefined;
  return { name, description, prompt: body, tools };
}
