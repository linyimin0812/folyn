// Study agent 运行时：在专用 study 会话里自动执行 study agent（PR9）。
//
// 取代 PR4 的"预填 prompt 到 ChatInput、用户手动发送"模式：
// - 不再 setPendingPrompt / addFileToChat；prompt 不显示在聊天输入框。
// - 在 aiStore 的专用 study 会话（kind='study'）里自动跑 adapter.send，
//   流式事件（text/thinking/tool_start/tool_end/file_change/session_id/error/done）
//   写入该 study 会话；不可编辑 prompt，AI 面板显示进度/工具调用/diff。
// - 复用 AiPanel.handleSend 的核心链路（workingDir=vault.basePath、
//   adapter.start/send、pauseWatcher/resumeWatcher、refreshFileTree、checkDiskChanges），
//   但定位到 study 会话 id，且通过 --agent/--agents 内联交付 study agent 定义。
// - research/plan 返回行格式文本 → studyStore 捕获 effect 扫 study 会话最后
//   assistant 消息 → 建议卡片；feynman/selftest/sq3r 用 Edit 直编主题文档 →
//   fileChange → enterDiffReview/diff 横幅（PR5 链路不变）。

import type { CliStreamEvent, CliAgentDefinition } from '@quill/cli-adapter';
import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getAdapterForSession } from '@/components/ai/adapterManager';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import { STUDY_AGENT_NAME, getStudyAgentDefinition } from './studyAgent';

export interface RunStudyAgentOpts {
  /** Agent 名（默认 study）。 */
  agent?: string;
  /** 内联 agent 定义（默认由 canonical study-agent.md 构造）。 */
  agents?: Record<string, CliAgentDefinition>;
  /** 额外可读目录。 */
  addDir?: string[];
}

/**
 * 在专用 study 会话里运行 study agent。首次创建 study 会话，后续复用以
 * resume cliSessionId（多轮）。指令由调用方构造（见 scheduleLink.buildStudyInstruction），
 * 静态输出契约由 canonical agent 文件的 system prompt 承载。
 */
export async function runStudyAgent(
  instruction: string,
  opts: RunStudyAgentOpts = {},
): Promise<void> {
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
  const agent = opts.agent ?? STUDY_AGENT_NAME;
  const agents = opts.agents ?? getStudyAgentDefinition();

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
    await adapter.send(instruction, { resumeSessionId, agent, agents, addDir: opts.addDir });
  } catch (err) {
    ai.appendToLastMessage(`\n\n[错误] ${String(err)}`, sid);
    useAiStore.getState().setSessionStreaming(sid, false);
    resumeWatcher();
  } finally {
    adapter.offEvent(eventHandler);
  }
}
