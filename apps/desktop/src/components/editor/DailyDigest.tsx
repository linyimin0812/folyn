import { useState, useCallback } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { VaultEntry } from '@quill/vault-provider';
import { MessageContent } from '../ai/MessageContent';
import { getFeatureAgentSendOptions } from '@/services/featureAgentService';

interface ModifiedFile {
  path: string;
  name: string;
  summary: string;
}

function flattenAllMdFiles(entries: VaultEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith('.md')) {
      paths.push(entry.path);
    } else if (entry.type === 'dir' && entry.children) {
      paths.push(...flattenAllMdFiles(entry.children));
    }
  }
  return paths;
}

interface DailyDigestProps {
  currentFilePath: string;
  onInsertContent: (content: string) => void;
}

export function DailyDigest({ currentFilePath, onInsertContent }: DailyDigestProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [digest, setDigest] = useState('');
  const [, setModifiedFiles] = useState<ModifiedFile[]>([]);

  const dailyDir = useSettingsStore((s) => s.dailyNotesDir || '__daily__');
  const isDailyNote = currentFilePath.startsWith(dailyDir + '/');

  const generateDigest = useCallback(async () => {
    setIsGenerating(true);
    setDigest('');

    try {
      const { fileTree, readFile } = useVaultStore.getState();
      const allMdPaths = flattenAllMdFiles(fileTree);

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const modified: ModifiedFile[] = [];

      for (const path of allMdPaths) {
        if (path === currentFilePath) continue;
        try {
          const content = await readFile(path);
          const name = path.split('/').pop() || path;
          const summary = content.slice(0, 500);
          if (content.includes(todayStr) || modified.length < 5) {
            modified.push({ path, name, summary });
          }
          if (modified.length >= 10) break;
        } catch {
          // Skip unreadable files
        }
      }

      setModifiedFiles(modified);

      const { CliAdapterRegistry } = await import('@quill/cli-adapter');
      const settings = useSettingsStore.getState();
      const adapter = CliAdapterRegistry.getInstance().create(settings.cliAdapter);
      const vault = useVaultStore.getState().currentVault;
      let workingDir = vault?.basePath ?? '';
      if (workingDir.startsWith('~')) {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/\/+$/, '');
        workingDir = home + workingDir.slice(1);
      }

      const fileSummaries = modified
        .map((f) => `- ${f.name}: ${f.summary.slice(0, 200)}`)
        .join('\n');

      let recentDailyContext = '';
      const dailyDir2 = settings.dailyNotesDir || '__daily__';
      for (let i = 1; i <= 3; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        try {
          const content = await readFile(`${dailyDir2}/${ds}.md`);
          recentDailyContext += `\n[${ds}]\n${content.slice(0, 300)}\n`;
        } catch {
          // No daily note for that day
        }
      }

      const prompt = `你是 Quill 知识库的 AI 助手。请生成今日（${todayStr}）的写作回顾，包含以下内容：
1. 今日修改/创建的文档列表和简要内容摘要
2. 工作/写作主题总结
3. 与过去笔记的关联提示（如果能发现关联）

今日修改的文档:
${fileSummaries || '(无修改记录)'}

最近几天的日记:
${recentDailyContext || '(无历史日记)'}

请输出 Markdown 格式的简洁回顾，控制在 300 字以内。`;

      let result = '';

      const sendOpts = await getFeatureAgentSendOptions('daily');

      await new Promise<void>((resolve, reject) => {
        adapter.onEvent((event) => {
          if (event.type === 'text' && event.content) {
            result += event.content;
          }
          if (event.type === 'done') resolve();
          if (event.type === 'error') reject(new Error(event.content));
        });
        adapter.start({ cliPath: settings.cliPath, workingDir }).then(() => {
          adapter.send(prompt, sendOpts);
        }).catch(reject);
      });

      setDigest(result.trim());
    } catch (err) {
      setDigest(`生成失败: ${err}`);
    } finally {
      setIsGenerating(false);
    }
  }, [currentFilePath, dailyDir]);

  if (!isDailyNote) return null;

  return (
    <div className="daily-digest">
      <button
        className="daily-digest-toggle"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="daily-digest-icon">{collapsed ? '▶' : '▼'}</span>
        <span>AI Daily Digest</span>
      </button>

      {!collapsed && (
        <div className="daily-digest-body">
          {!digest && !isGenerating && (
            <div className="daily-digest-empty">
              <button
                className="daily-digest-generate-btn"
                onClick={generateDigest}
              >
                生成回顾
              </button>
              <span className="daily-digest-hint">AI 将分析今日的写作活动并生成回顾</span>
            </div>
          )}

          {isGenerating && (
            <div className="daily-digest-loading">
              <span className="ft-spinner" /> 正在生成回顾...
            </div>
          )}

          {digest && (
            <div className="daily-digest-content">
              <MessageContent content={digest} />
              <button
                className="daily-digest-insert-btn"
                onClick={() => onInsertContent(`\n\n---\n\n## AI Daily Digest\n\n${digest}\n`)}
              >
                插入到笔记
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
