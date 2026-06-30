// Study agent：canonical 定义文件（study-agent.md，版本控制）+ 运行时内联交付。
//
// Claude CLI 支持 `--agents '<json>'`（`{"<name>":{"description","prompt","tools"}}`）
// 与 `--agent <name>`。因为 cwd=vault 因用户而异、仓库文件不会被 CLI 自动发现，
// 且应避免污染全局 `~/.claude/agents/`——本模块把 canonical .md 在构建时通过
// Vite `?raw` import 打进 bundle，运行时解析为 `--agents` JSON 内联传递 + `--agent study`。
// 这样 canonical 文件是唯一来源，scope 仅限本次 Quill 调用，不写用户文件系统。

import agentDoc from './study-agent.md?raw';
import type { CliAgentDefinition } from '@quill/cli-adapter';

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

/** 解析 canonical agent 文件为定义对象（纯函数，便于单测）。 */
export function getStudyAgentDef(): StudyAgentDef {
  const { fm, body } = parseFrontmatter(agentDoc);
  const name = typeof fm.name === 'string' && fm.name ? fm.name : STUDY_AGENT_NAME;
  const description = typeof fm.description === 'string' ? fm.description : '';
  const tools = Array.isArray(fm.tools) && fm.tools.length > 0 ? fm.tools : undefined;
  return { name, description, prompt: body, tools };
}

/** 构造 Claude CLI `--agents` 的内联 agent 定义对象（scope 仅限本次调用）。 */
export function getStudyAgentDefinition(): Record<string, CliAgentDefinition> {
  const def = getStudyAgentDef();
  const entry: CliAgentDefinition = { prompt: def.prompt };
  if (def.description) entry.description = def.description;
  if (def.tools) entry.tools = def.tools;
  return { [def.name]: entry };
}
