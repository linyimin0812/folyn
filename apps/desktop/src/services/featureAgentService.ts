// Feature agent 框架（PR1）：canonical agent 文件播种 + runFeatureAgent（cwd 发现 vs --bare 回退）。
//
// 设计见 `.trellis/tasks/07-01-feature-agent-generalization/prd.md`：
// - canonical agent 文件按功能就近放 `apps/desktop/src/<feature>/.claude/agents/<feature>.md`。
// - vault 切换/启动时把 canonical 文件拷贝到 `<vault>/.claude/agents/<file>`，**write-if-missing**（不覆盖用户修改）。
// - feature agent 调用：agent 文件存在 → `adapter.send(instruction, {agent, bare:false})`（cwd=vault 自动发现）；
//   不存在 → 回退 `--bare`（无 agent，隔离）。
//
// 本 PR 只注册 study（analyze/clips/daily 在 PR3 加入注册表）。runFeatureAgent 只接 study
// feature 的会话路由（复用 aiStore study 会话机制）；PR2 把 study 调用迁到 runFeatureAgent，
// PR3 接 analyze/clips/daily。

import type { CliStreamEvent } from '@quill/cli-adapter';
import type { VaultManager } from '@quill/vault-provider';
import studyAgentDoc from '@/study/.claude/agents/study.md?raw';

/** Vault 内 agent 文件存放目录（相对 vault 根）。 */
const AGENTS_DIR = '.claude/agents';

/** 已注册的 feature agent（canonical 文件 → vault 播种目标）。 */
export interface FeatureAgentEntry {
  /** Feature 名（同时是 `--agent <name>` 的值与 vault 文件主名）。 */
  feature: string;
  /** vault 内文件名（`<AGENTS_DIR>/<file>`）。 */
  file: string;
  /** canonical 文件内容（`?raw` import）。 */
  doc: string;
}

/**
 * Feature agent 注册表。新增 feature 时在此登记 canonical 文件。
 * 本 PR 只注册 study；analyze/clips/daily 在 PR3 加入。
 */
export const FEATURE_AGENTS: FeatureAgentEntry[] = [
  { feature: 'study', file: 'study.md', doc: studyAgentDoc },
];

/** 取某 feature 的注册项（不存在返回 undefined）。 */
export function getFeatureAgentEntry(feature: string): FeatureAgentEntry | undefined {
  return FEATURE_AGENTS.find((e) => e.feature === feature);
}

/** vault 内 agent 文件的相对路径（`<AGENTS_DIR>/<file>`）。 */
export function agentFilePath(feature: string): string | null {
  const entry = getFeatureAgentEntry(feature);
  return entry ? `${AGENTS_DIR}/${entry.file}` : null;
}

/**
 * 检查 `<vault>/.claude/agents/<feature>.md` 是否存在（已播种或用户自建）。
 * vault 不可读 / 文件缺失 → 返回 false（调用方回退 `--bare`）。
 */
export async function agentFileExists(manager: VaultManager, feature: string): Promise<boolean> {
  const path = agentFilePath(feature);
  if (!path) return false;
  try {
    await manager.readFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把所有已注册的 canonical agent 文件播种到 `<vault>/.claude/agents/`。
 * **write-if-missing**：已存在的文件不覆盖（保留用户修改）。缺父目录会自动创建。
 *
 * 播种失败（vault 只读等）静默降级——调用时 `agentFileExists` 返回 false → `--bare` 回退。
 * 不抛错，不阻塞 vault 切换。
 */
export async function seedAgentFiles(manager: VaultManager): Promise<void> {
  // 先确保目录存在（非 tauri provider 的 writeFile 未必自动建父目录）。
  try {
    await manager.createDir(AGENTS_DIR);
  } catch {
    // 目录已存在或 vault 不可写——继续尝试逐文件写入。
  }

  for (const entry of FEATURE_AGENTS) {
    const path = `${AGENTS_DIR}/${entry.file}`;
    try {
      await manager.readFile(path);
      // 已存在（canonical 或用户修改）——不覆盖。
      continue;
    } catch {
      // 不存在 → 写入 canonical 内容。
      try {
        await manager.writeFile(path, entry.doc);
      } catch (err) {
        console.warn(`[featureAgent] seed failed for "${entry.feature}" at ${path}:`, err);
      }
    }
  }
}

// ── runFeatureAgent ──

/** runFeatureAgent 额外选项。 */
export interface RunFeatureAgentOpts {
  /** 额外可读目录（`--add-dir`）。 */
  addDir?: string[];
}

/**
 * 运行 feature agent。本 PR 只支持 `study`（PR3 扩展到 analyze/clips/daily）。
 *
 * 路径：
 * - `<vault>/.claude/agents/<feature>.md` 存在 → `adapter.send(instruction, {agent: feature, bare: false, ...})`，
 *   cwd=vault 自动发现 agent（去 `--bare`，加载 vault 的 CLAUDE.md/hooks）。
 * - 不存在 → 回退 `--bare`（无 agent，隔离，当前普通行为）。
 *
 * study feature 复用 aiStore 的专用 study 会话（getOrCreateStudySession）：事件路由到该会话，
 * 多轮复用 cliSessionId。其它 feature 本 PR 不支持（抛错，PR3 接入 bespoke 流程）。
 */
export async function runFeatureAgent(
  feature: string,
  instruction: string,
  opts: RunFeatureAgentOpts = {},
): Promise<void> {
  if (feature !== 'study') {
    throw new Error(`[featureAgent] feature "${feature}" not supported in PR1 (only study)`);
  }

  const { useAiStore } = await import('@/store/aiStore');
  const { useVaultStore } = await import('@/store/vaultStore');
  const { useEditorStore } = await import('@/store/editorStore');
  const { useSettingsStore } = await import('@/store/settingsStore');
  const { getAdapterForSession } = await import('@/components/ai/adapterManager');
  const { pauseWatcher, resumeWatcher } = await import('@/utils/fileWatcher');

  const ai = useAiStore.getState();
  const sid = ai.getOrCreateStudySession();
  const session = useAiStore.getState().sessions.find((s) => s.id === sid);
  const resumeSessionId = session?.cliSessionId ?? undefined;

  ai.addMessage('user', instruction, sid);
  ai.addMessage('assistant', '', sid);
  ai.setSessionStreaming(sid, true);

  const settings = useSettingsStore.getState();
  const vault = useVaultStore.getState().currentVault;
  let workingDir = vault?.basePath ?? '';
  if (workingDir.startsWith('~')) {
    try {
      const { homeDir } = await import('@tauri-apps/api/path');
      const home = (await homeDir()).replace(/\/+$/, '');
      workingDir = home + workingDir.slice(1);
    } catch {
      // 路径解析失败时退回原始值
    }
  }

  const adapter = getAdapterForSession(sid);
  const manager = useVaultStore.getState().manager;
  const available = await agentFileExists(manager, feature);

  // agent 文件存在 → cwd 发现（bare:false + --agent）；缺失 → --bare 回退（无 agent）。
  const sendOptions = available
    ? { agent: feature, bare: false, resumeSessionId, addDir: opts.addDir }
    : { bare: true, resumeSessionId, addDir: opts.addDir };

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
        useEditorStore.getState().checkDiskChanges().finally(() => {
          resumeWatcher();
        });
        break;
    }
  };

  adapter.onEvent(eventHandler);
  await useEditorStore.getState().flushAutoSaves();
  pauseWatcher();

  try {
    await adapter.start({ cliPath: settings.cliPath, workingDir });
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
    const { useVaultStore } = await import('@/store/vaultStore');
    const manager = useVaultStore.getState().manager;
    return await agentFileExists(manager, feature);
  } catch {
    return false;
  }
}
