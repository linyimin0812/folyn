import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVaultStore } from '@/store/vaultStore';
import { usePrefsStore } from '@/store/prefsStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import type { VaultEntry } from '@quill/vault-provider';
import { MessageContent } from '@/components/chat';
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
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [digest, setDigest] = useState('');
  const [, setModifiedFiles] = useState<ModifiedFile[]>([]);

  const dailyDir = usePrefsStore((s) => s.dailyNotesDir || '__daily__');
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

      const { createAdapter } = await import('@quill/cli-adapter');
      const { cliAdapter, cliPath } = useAiConfigStore.getState();
      const adapter = createAdapter(cliAdapter);
      const vault = useVaultStore.getState().currentVault;
      let workingDir = vault?.basePath ?? '';
      if (workingDir.startsWith('~')) {
        const { homeDir, join } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/[/\\]+$/, '');
        // ponytail: join() is separator-aware — string concat produced mixed
        // separators on Windows failing the fs scope glob.
        workingDir = await join(home, workingDir.slice(1));
      }
      // schedule agent cwd = `<vault>/__schedule__/`；feature agent 在此自动发现
      // `.claude/agents/schedule.md`，并通过 `--add-dir <vault>` 访问 `__daily__/` 日记。
      const { join: joinPath } = await import('@tauri-apps/api/path');
      workingDir = await joinPath(workingDir.replace(/[/\\]+$/, ''), '__schedule__');

      const fileSummaries = modified
        .map((f) => `- ${f.name}: ${f.summary.slice(0, 200)}`)
        .join('\n');

      let recentDailyContext = '';
      const dailyDir2 = usePrefsStore.getState().dailyNotesDir || '__daily__';
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

      const prompt = `${t('editor:dailyDigest.today', { date: todayStr })}

## ${t('editor:dailyDigest.modifiedSection')}
${fileSummaries || t('editor:dailyDigest.modifiedEmpty')}

## ${t('editor:dailyDigest.recentDailySection')}
${recentDailyContext || t('editor:dailyDigest.recentDailyEmpty')}`;

      let result = '';

      const sendOpts = await getFeatureAgentSendOptions('schedule');

      await new Promise<void>((resolve, reject) => {
        adapter.onEvent((event) => {
          if (event.type === 'text' && event.content) {
            result += event.content;
          }
          if (event.type === 'done') resolve();
          if (event.type === 'error') reject(new Error(event.content));
        });
        adapter.start({ cliPath, workingDir }).then(() => {
          adapter.send(prompt, sendOpts);
        }).catch(reject);
      });

      setDigest(result.trim());
    } catch (err) {
      setDigest(t('editor:dailyDigest.generateFailed', { error: String(err) }));
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
        <span>{t('editor:dailyDigest.title')}</span>
      </button>

      {!collapsed && (
        <div className="daily-digest-body">
          {!digest && !isGenerating && (
            <div className="daily-digest-empty">
              <button
                className="daily-digest-generate-btn"
                onClick={generateDigest}
              >
                {t('editor:dailyDigest.generate')}
              </button>
              <span className="daily-digest-hint">{t('editor:dailyDigest.hint')}</span>
            </div>
          )}

          {isGenerating && (
            <div className="daily-digest-loading">
              <span className="ft-spinner" /> {t('editor:dailyDigest.loading')}
            </div>
          )}

          {digest && (
            <div className="daily-digest-content">
              <MessageContent content={digest} />
              <button
                className="daily-digest-insert-btn"
                onClick={() => onInsertContent(`\n\n---\n\n## AI Daily Digest\n\n${digest}\n`)}
              >
                {t('editor:dailyDigest.insert')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
