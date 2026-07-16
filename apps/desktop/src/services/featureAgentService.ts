// Feature agent 框架：canonical agent 文件播种 + runFeatureAgent + getFeatureAgentSendOptions。
//
// 设计见 `.trellis/tasks/07-01-refactor-study-wiki-clips-schedule-project-analysis-to-per-vault-claude-agents/prd.md`：
// - 每 feature 独立子目录 `<vault>/__{feature}__/.claude/`（含 CLAUDE.md + agents/<feature>.md）。
// - canonical 源文件按功能就近放 `apps/desktop/src/<feature>/.claude/{CLAUDE.md,agents/<feature>.md}`，经 `?raw` import。
// - vault 切换/启动时把 canonical 文件拷贝到 `<vault>/__{feature}__/.claude/`，**write-if-missing**（不覆盖用户修改）。
// - feature agent 调用：agent 文件存在 → `adapter.send(instruction, {agent, bare:false})`（cwd=`__{feature}__/` 自动发现）；
//   不存在 → 回退 `--bare` + `--agents` 内联交付 canonical agent 定义（contract 不丢，spec `feature-agents.md` Validation Matrix 承诺的 graceful degradation）。
// - schedule feature 额外传 `--add-dir <vault>` 以便访问 `__daily__/` 日记与今日修改文档。

import type { CliAgentDefinition, CliSendOptions, CliStreamEvent } from '@quill/cli-adapter';
import type { VaultManager } from '@quill/vault-provider';
import studyAgentDoc from '@/features/study/.claude/agents/study.md?raw';
import studyClaudeDoc from '@/features/study/.claude/CLAUDE.md?raw';
import analyzeAgentDoc from '@/features/analyze/.claude/agents/analyze.md?raw';
import analyzeClaudeDoc from '@/features/analyze/.claude/CLAUDE.md?raw';
import clipsAgentDoc from '@/features/clips/.claude/agents/clips.md?raw';
import clipsClaudeDoc from '@/features/clips/.claude/CLAUDE.md?raw';
import scheduleAgentDoc from '@/features/schedule/.claude/agents/schedule.md?raw';
import scheduleClaudeDoc from '@/features/schedule/.claude/CLAUDE.md?raw';
import wikiAgentDoc from '@/features/wiki/.claude/agents/wiki.md?raw';
import wikiClaudeDoc from '@/features/wiki/.claude/CLAUDE.md?raw';
import { resolveBasePath } from '@/utils/pathResolver';

/** Feature 子目录名前缀/后缀（双下划线包裹，与现有 `__clips__` / `__wiki__` / `__daily__` 约定一致）。 */
function featureDir(feature: string): string {
  return `__${feature}__`;
}

/** Vault 内 .claude 目录（相对 vault 根）。 */
function claudeDir(feature: string): string {
  return `${featureDir(feature)}/.claude`;
}

/** Vault 内 agent 文件存放目录（相对 vault 根）。 */
function agentsDir(feature: string): string {
  return `${claudeDir(feature)}/agents`;
}

/** Vault 内 CLAUDE.md 路径（相对 vault 根）。 */
function claudeMdPath(feature: string): string {
  return `${claudeDir(feature)}/CLAUDE.md`;
}

/** Vault 内 agent 文件路径（相对 vault 根）。 */
function agentFilePath(feature: string, file: string): string {
  return `${agentsDir(feature)}/${file}`;
}

/** 诊断日志目录（相对 vault 根；已在 excludePatterns 里，不污染文件树）。 */
const SEED_LOG_DIR = '.quill-tmp';
/** 诊断日志文件路径（相对 vault 根）。 */
const SEED_LOG_PATH = `${SEED_LOG_DIR}/feature-agent-seed.log`;

/** 已注册的 feature agent（canonical 文件 → vault 播种目标）。 */
export interface FeatureAgentEntry {
  /** Feature 名（同时是 `--agent <name>` 的值与 vault 文件主名）。 */
  feature: string;
  /** vault 内 agent 文件名（`<agentsDir(feature)>/<file>`）。 */
  file: string;
  /** canonical agent 文件内容（`?raw` import）。 */
  doc: string;
  /** canonical CLAUDE.md 内容（`?raw` import）。 */
  claudeDoc: string;
  /** 调用时是否额外传 `--add-dir <vault>`（schedule 需要跨目录访问 `__daily__/`）。 */
  addVaultDir?: boolean;
}

/**
 * Feature agent 注册表。新增 feature 时在此登记 canonical 文件。
 * - study 走 aiStore 会话（runFeatureAgent）。
 * - analyze/clips/schedule/wiki 走 bespoke 流程（getFeatureAgentSendOptions 仅给 adapter.send 提供 options）。
 */
export const FEATURE_AGENTS: FeatureAgentEntry[] = [
  { feature: 'study', file: 'study.md', doc: studyAgentDoc, claudeDoc: studyClaudeDoc },
  { feature: 'analyze', file: 'analyze.md', doc: analyzeAgentDoc, claudeDoc: analyzeClaudeDoc },
  { feature: 'clips', file: 'clips.md', doc: clipsAgentDoc, claudeDoc: clipsClaudeDoc },
  { feature: 'schedule', file: 'schedule.md', doc: scheduleAgentDoc, claudeDoc: scheduleClaudeDoc, addVaultDir: true },
  { feature: 'wiki', file: 'wiki.md', doc: wikiAgentDoc, claudeDoc: wikiClaudeDoc },
];

/** 取某 feature 的注册项（不存在返回 undefined）。 */
export function getFeatureAgentEntry(feature: string): FeatureAgentEntry | undefined {
  return FEATURE_AGENTS.find((e) => e.feature === feature);
}

/**
 * 从 canonical agent .md frontmatter 解析出 `CliAgentDefinition`。
 * canonical 形如：
 * ```
 * ---
 * name: clips
 * description: ...
 * tools: WebFetch, WebSearch, Read
 * ---
 * <body>
 * ```
 * frontmatter 缺失或字段缺失时降级（至少返回 `{ prompt: <整份 md> }`）。
 *
 * 用于 fallback 路径：agent 文件未播种时，把解析后的 definition 通过 `--agents` flag 内联交付给 CLI，
 * 让 agent 仍能拿到输出契约（spec `feature-agents.md` Validation Matrix）。
 */
function parseAgentDoc(md: string): CliAgentDefinition {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { prompt: md };
  }
  const fm = fmMatch[1];
  const body = fmMatch[2];
  const description = matchField(fm, 'description');
  const toolsLine = matchField(fm, 'tools');
  const tools = toolsLine
    ? toolsLine.split(',').map((t) => t.trim()).filter(Boolean)
    : undefined;
  return { description, prompt: body, tools };
}

/** 从 frontmatter 文本中取 `<key>: <value>` 行的 value（去引号、trim）；不存在返回 undefined。 */
function matchField(fm: string, key: string): string | undefined {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return undefined;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/** vault 内 agent 文件的相对路径（`__{feature}__/.claude/agents/<file>`）；未注册返回 null。 */
export function agentFilePathOf(feature: string): string | null {
  const entry = getFeatureAgentEntry(feature);
  return entry ? agentFilePath(entry.feature, entry.file) : null;
}

/** vault 内 CLAUDE.md 的相对路径（`__{feature}__/.claude/CLAUDE.md`）；未注册返回 null。 */
export function claudeMdPathOf(feature: string): string | null {
  const entry = getFeatureAgentEntry(feature);
  return entry ? claudeMdPath(entry.feature) : null;
}

/**
 * 调用时的懒播种兜底：即使启动时 switchVault 的 seeding 被跳过/失败，
 * 首次调用也会补播种。幂等（write-if-missing，安全）。
 *
 * 取 manager：动态 import vaultStore 避免循环依赖（runFeatureAgent 已有此模式）。
 * 失败静默（seedAgentFiles 内部已 catch）。
 */
async function lazySeedAgentFiles(): Promise<void> {
  try {
    const { useVaultStore } = await import('@/store/vaultStore');
    const manager = useVaultStore.getState().manager;
    if (!manager) return;
    await seedAgentFiles(manager);
  } catch (err) {
    console.warn('[featureAgent] lazy seed failed:', err);
  }
}

/**
 * 检查 `<vault>/__{feature}__/.claude/agents/<feature>.md` 是否存在（已播种或用户自建）。
 * vault 不可读 / 文件缺失 → 返回 false（调用方回退 `--bare`）。
 */
export async function agentFileExists(manager: VaultManager, feature: string): Promise<boolean> {
  const entry = getFeatureAgentEntry(feature);
  if (!entry) return false;
  const path = agentFilePath(entry.feature, entry.file);
  try {
    await manager.readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** 单个 feature 播种结果（agent 文件 + CLAUDE.md 各一条）。 */
export interface SeedAgentResult {
  feature: string;
  path: string;
  /** 'seeded' (新写) | 'exists' (已存在未覆盖) | 'failed' (写失败)。 */
  status: 'seeded' | 'exists' | 'failed';
  /** status==='failed' 时的错误信息。 */
  error?: string;
}

/**
 * 把所有已注册的 canonical 文件（agent .md + CLAUDE.md）播种到 `<vault>/__{feature}__/.claude/`。
 * **write-if-missing**：已存在的文件不覆盖（保留用户修改）。缺父目录会自动创建。
 *
 * 播种失败（vault 只读等）静默降级——调用时 `agentFileExists` 返回 false → `--bare` 回退。
 * 不抛错，不阻塞 vault 切换。返回每个文件路径的播种结果（用于诊断）。
 */
export async function seedAgentFiles(manager: VaultManager): Promise<SeedAgentResult[]> {
  const results: SeedAgentResult[] = [];

  // 先确保所有 feature 的 agents/ 目录存在（非 tauri provider 的 writeFile 未必自动建父目录）。
  for (const entry of FEATURE_AGENTS) {
    try {
      await manager.createDir(agentsDir(entry.feature));
    } catch {
      // 目录已存在或 vault 不可写——继续尝试逐文件写入。
    }
  }

  for (const entry of FEATURE_AGENTS) {
    // CLAUDE.md
    const claudePath = claudeMdPath(entry.feature);
    try {
      await manager.readFile(claudePath);
      results.push({ feature: entry.feature, path: claudePath, status: 'exists' });
    } catch {
      try {
        await manager.writeFile(claudePath, entry.claudeDoc);
        results.push({ feature: entry.feature, path: claudePath, status: 'seeded' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[featureAgent] seed CLAUDE.md failed for "${entry.feature}" at ${claudePath}:`, err);
        results.push({ feature: entry.feature, path: claudePath, status: 'failed', error: msg });
      }
    }

    // agent .md
    const agentPath = agentFilePath(entry.feature, entry.file);
    try {
      await manager.readFile(agentPath);
      // 已存在（canonical 或用户修改）——不覆盖。
      results.push({ feature: entry.feature, path: agentPath, status: 'exists' });
    } catch {
      try {
        await manager.writeFile(agentPath, entry.doc);
        results.push({ feature: entry.feature, path: agentPath, status: 'seeded' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[featureAgent] seed agent failed for "${entry.feature}" at ${agentPath}:`, err);
        results.push({ feature: entry.feature, path: agentPath, status: 'failed', error: msg });
      }
    }
  }

  // 写诊断日志到 <vault>/.quill-tmp/feature-agent-seed.log（失败不抛）。
  await writeSeedLog(manager, results);
  return results;
}

/**
 * 把播种结果写入 `<vault>/.quill-tmp/feature-agent-seed.log`。
 * webview console 在终端看不到——写文件让用户能直接在 vault 里确认 seeding 是否生效。
 * 失败静默（只 console.warn）。
 */
async function writeSeedLog(manager: VaultManager, results: SeedAgentResult[]): Promise<void> {
  const ts = new Date().toISOString();
  const lines: string[] = [
    `# feature-agent seeding diagnostic`,
    `timestamp: ${ts}`,
    `vault-manager: ${manager ? 'present' : 'null'}`,
    ``,
    `## results (${results.length})`,
  ];
  for (const r of results) {
    const detail = r.status === 'failed' ? ` — error: ${r.error}` : '';
    lines.push(`- ${r.feature}: ${r.status} (${r.path})${detail}`);
  }
  lines.push(``);
  const content = lines.join('\n');
  try {
    try {
      await manager.createDir(SEED_LOG_DIR);
    } catch {
      // 目录已存在或不可写——继续尝试写文件。
    }
    // 覆盖写（每次播种刷新日志，便于诊断最新一次）。
    await manager.writeFile(SEED_LOG_PATH, content);
    console.log(`[featureAgent] seed log written to ${SEED_LOG_PATH}`);
  } catch (err) {
    console.warn(`[featureAgent] failed to write seed log at ${SEED_LOG_PATH}:`, err);
  }
}

// ── runFeatureAgent ──

/** runFeatureAgent 额外选项。 */
export interface RunFeatureAgentOpts {
  /** 额外可读目录（`--add-dir`）。 */
  addDir?: string[];
}

/**
 * 运行 feature agent（cwd=`<vault>/__{feature}__/`）。
 *
 * 路径：
 * - `<vault>/__{feature}__/.claude/agents/<feature>.md` 存在 → `adapter.send(instruction, {agent: feature, bare: false, ...})`，
 *   cwd=`__{feature}__/` 自动发现 agent（去 `--bare`，加载 feature 级 CLAUDE.md/hooks）。
 * - 不存在 → 回退 `--bare` + `--agents` 内联交付 canonical agent 定义（contract 不丢，spec graceful degradation）。
 *
 * study feature 复用 aiStore 的专用 study 会话（getOrCreateStudySession）：事件路由到该会话，
 * 多轮复用 cliSessionId。其它 feature 走 bespoke 流程，应使用 getFeatureAgentSendOptions
 * 自行驱动 adapter（runFeatureAgent 仅支持 study）。
 */
export async function runFeatureAgent(
  feature: string,
  instruction: string,
  opts: RunFeatureAgentOpts = {},
): Promise<void> {
  if (feature !== 'study') {
    throw new Error(`[featureAgent] feature "${feature}" not supported by runFeatureAgent (only study; others use bespoke flow via getFeatureAgentSendOptions)`);
  }

  const { useAiStore } = await import('@/store/aiStore');
  const { useVaultStore } = await import('@/store/vaultStore');
  const editorIo = await import('@/services/editorIoService');
  const { useAiConfigStore } = await import('@/store/aiConfigStore');
  const { getAdapterForSession } = await import('@/components/ai/adapterManager');
  const { pauseWatcher, resumeWatcher } = await import('@/utils/fileWatcher');

  const ai = useAiStore.getState();
  const sid = ai.getOrCreateStudySession();
  const session = useAiStore.getState().sessions.find((s) => s.id === sid);
  const resumeSessionId = session?.cliSessionId ?? undefined;

  ai.addMessage('user', instruction, sid);
  ai.addMessage('assistant', '', sid);
  ai.setSessionStreaming(sid, true);

  const aiConfig = useAiConfigStore.getState();
  const vault = useVaultStore.getState().currentVault;
  let workingDir = vault?.basePath ?? '';
  if (workingDir.startsWith('~')) {
    try {
      workingDir = await resolveBasePath(workingDir);
    } catch {
      // 路径解析失败时退回原始值
    }
  }
  // cwd = `<vault>/__{feature}__/`：agent 自动发现 `.claude/agents/<feature>.md`。
  const entry = getFeatureAgentEntry(feature);
  if (entry) {
    workingDir = `${workingDir.replace(/\/+$/, '')}/${featureDir(feature)}`;
  }

  const adapter = getAdapterForSession(sid);
  const manager = useVaultStore.getState().manager;

  // 调用时懒播种兜底：确保 agent 文件已落盘（即使 switchVault 的 seeding 被跳过/失败）。
  // 幂等（write-if-missing），不会覆盖用户修改。
  await lazySeedAgentFiles();

  const available = await agentFileExists(manager, feature);

  // agent 文件存在 → cwd 发现（bare:false + --agent）。
  // 缺失 → --bare 回退 + `--agents` 内联交付 canonical agent 定义（contract 不丢，spec graceful degradation）。
  let sendOptions: CliSendOptions;
  if (available) {
    sendOptions = { agent: feature, bare: false, resumeSessionId, ...(opts.addDir ? { addDir: opts.addDir } : {}) };
  } else if (entry) {
    const def = parseAgentDoc(entry.doc);
    sendOptions = {
      agent: feature,
      bare: true,
      agents: { [feature]: def },
      resumeSessionId,
      ...(opts.addDir ? { addDir: opts.addDir } : {}),
    };
  } else {
    sendOptions = { bare: true, resumeSessionId, ...(opts.addDir ? { addDir: opts.addDir } : {}) };
  }

  const eventHandler = (event: CliStreamEvent) => {
    switch (event.type) {
      case 'text':
        if (event.content) ai.appendToLastMessage(event.content, sid);
        break;
      case 'thinking':
        if (event.content) ai.appendThinking(event.content, sid);
        break;
      case 'tool_start':
        if (event.toolId && event.toolName) ai.addToolCall(event.toolId, event.toolName, event.toolInput, sid);
        break;
      case 'tool_end':
        if (event.toolId) ai.completeToolCall(event.toolId, event.toolOutput, sid);
        break;
      case 'file_change':
        if (event.fileChange) ai.addFileChange(event.fileChange, sid);
        break;
      case 'session_id':
        if (event.sessionId) ai.setCliSessionId(event.sessionId, sid);
        break;
      case 'error':
        if (event.content) ai.appendToLastMessage(`\n\n[错误] ${event.content}`, sid);
        break;
      case 'done':
        useAiStore.getState().setSessionStreaming(sid, false);
        adapter.offEvent(eventHandler);
        useVaultStore.getState().refreshFileTree().catch(() => {});
        editorIo.checkDiskChanges().finally(() => {
          resumeWatcher();
        });
        break;
    }
  };

  adapter.onEvent(eventHandler);
  await editorIo.flushAutoSaves();
  pauseWatcher();

  try {
    await adapter.start({ cliPath: aiConfig.cliPath, workingDir });
    await adapter.send(instruction, sendOptions);
  } catch (err) {
    ai.appendToLastMessage(`\n\n[错误] ${String(err)}`, sid);
    useAiStore.getState().setSessionStreaming(sid, false);
    resumeWatcher();
  } finally {
    adapter.offEvent(eventHandler);
  }
}

/**
 * feature agent 是否可用（agent 文件已播种/用户自建 + adapter 配置就绪）。
 * 供 UI 禁用按钮：agent 不存在时走 `--bare` 回退（仍可调用，但不是"feature agent 模式"）。
 */
export async function isAgentAvailable(feature: string): Promise<boolean> {
  try {
    // 调用时懒播种兜底（幂等，安全）。
    await lazySeedAgentFiles();
    const { useVaultStore } = await import('@/store/vaultStore');
    const manager = useVaultStore.getState().manager;
    return await agentFileExists(manager, feature);
  } catch {
    return false;
  }
}

/**
 * 给 bespoke feature service（analyze/clips/schedule/wiki）用的轻量辅助：返回 `adapter.send`
 * 的 options 片段。这些 feature 不走 aiStore 会话，保留各自 collectTextFromStream /
 * setDigest 结果处理；只把 send 从无 options 升级为 feature-agent 模式。
 *
 * - agent 文件存在 → `{ agent: feature, bare: false, addDir? }`（cwd=`__{feature}__/` 自动发现）。
 *   schedule feature 额外传 `addDir: ['<vaultbasePath>']` 以便访问 `__daily__/` 日记。
 * - 不存在 / vault 不可读 → `{ agent: feature, bare: true, agents: { [feature]: def }, addDir? }`
 *   （`--bare` 回退 + `--agents` 内联交付 canonical agent 定义，contract 不丢，spec graceful degradation）。
 *
 * 调用方把自己的 `adapter.send(prompt)` 改为 `adapter.send(prompt, await getFeatureAgentSendOptions(feature))`。
 * workingDir 仍由调用方在 `adapter.start({workingDir})` 处设为 `<vault>/__{feature}__/`。
 */
export async function getFeatureAgentSendOptions(feature: string): Promise<CliSendOptions> {
  try {
    // 调用时懒播种兜底（幂等，安全）。
    await lazySeedAgentFiles();
    const { useVaultStore } = await import('@/store/vaultStore');
    const vault = useVaultStore.getState();
    const manager = vault.manager;
    const available = await agentFileExists(manager, feature);
    const entry = getFeatureAgentEntry(feature);

    // schedule feature 需要 --add-dir <vault> 访问 __daily__/ 日记与今日修改文档。
    let addDir: string[] | undefined;
    if (entry?.addVaultDir && vault.currentVault) {
      let basePath = vault.currentVault.basePath;
      if (basePath.startsWith('~')) {
        try {
          basePath = await resolveBasePath(basePath);
        } catch {
          // 路径解析失败时退回原始值
        }
      }
      addDir = [basePath];
    }

    if (available) {
      return { agent: feature, bare: false, ...(addDir ? { addDir } : {}) };
    }
    // Fallback: 内联交付 canonical agent 定义 via --agents flag。
    // agent 文件未播种 / vault 不可读时仍把 contract 交给 CLI（spec graceful degradation）。
    if (entry) {
      const def = parseAgentDoc(entry.doc);
      return {
        agent: feature,
        bare: true,
        agents: { [feature]: def },
        ...(addDir ? { addDir } : {}),
      };
    }
    return { bare: true, ...(addDir ? { addDir } : {}) };
  } catch {
    // 异常路径也尝试内联交付（registry 是静态的，不依赖 vault）。
    const entry = getFeatureAgentEntry(feature);
    if (entry) {
      const def = parseAgentDoc(entry.doc);
      return { agent: feature, bare: true, agents: { [feature]: def } };
    }
    return { bare: true };
  }
}
