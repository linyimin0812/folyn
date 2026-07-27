/**
 * CLI 工具 settings tab — one card per CLI adapter (Claude Code / Pi / …),
 * each owning its binary path + detect + test. There is NO "active adapter"
 * selection here: which adapter a chat session runs is chosen inline in the
 * AI Panel / pet Chat (see AdapterSelector). This tab only configures paths.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { listAdapters, buildAdapterVersionCommand } from '@quill/cli-adapter';

type TestStatus = { testing: boolean; result?: { success: boolean; message: string } };

export function CliSettings() {
  const { t } = useTranslation();
  const cliPaths = useAiConfigStore((s) => s.cliPaths);
  const setCliPathFor = useAiConfigStore((s) => s.setCliPathFor);
  // Per-adapter test result state, keyed by adapter id.
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:cli.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:cli.description')}</div>
      </div>
      <div className="text-[10.5px] text-t3 mb-3">
        每个 Adapter 独立配置可执行文件路径；会话使用哪个 Adapter 在 AI Panel / 桌宠 Chat 里选，此处仅做配置。
      </div>
      <div className="flex flex-col gap-3">
        {listAdapters().map((a) => {
          const path = cliPaths[a.id] ?? a.id;
          const st = testStatus[a.id] ?? { testing: false };
          return (
            <div
              key={a.id}
              className="rounded-lg border border-brd bg-surf px-3.5 py-3"
            >
              <div className="flex items-baseline gap-2 mb-2">
                <div className="text-[length:calc(var(--ui-font-size))] font-bold text-t1 font-mono">{a.displayName}</div>
              </div>
              <div className="text-[10.5px] text-t3 mb-2">{a.description}</div>
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">
                {t('settings:cli.cliPath.label')}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
                  style={{ flex: 1 }}
                  value={path}
                  onChange={(e) => setCliPathFor(a.id, e.target.value)}
                  placeholder={a.id}
                  autoCapitalize="off"
                />
                <button
                  className="btn btn-g btn-sm"
                  title={t('settings:cli.cliPath.detectTitle')}
                  onClick={async () => {
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const adapterCmd = a.id === 'claude' ? 'claude' : a.id;
                      const cmd = Command.create('claude-cli', ['-l', '-c', `which ${adapterCmd}`]);
                      const output = await cmd.execute();
                      const detected = output.stdout.trim().split('\n')[0];
                      if (output.code === 0 && detected) {
                        setCliPathFor(a.id, detected);
                      }
                    } catch {}
                  }}
                >{t('settings:cli.cliPath.detect')}</button>
                <button
                  className="btn btn-g btn-sm"
                  disabled={st.testing}
                  onClick={async () => {
                    setTestStatus((s) => ({ ...s, [a.id]: { testing: true } }));
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const p = useAiConfigStore.getState().cliPaths[a.id] ?? a.id;
                      const cmd = Command.create('claude-cli', ['-l', '-c', buildAdapterVersionCommand(a.id, p)]);
                      const output = await cmd.execute();
                      if (output.code === 0) {
                        const version = output.stdout.trim().split('\n')[0];
                        setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: true, message: version || t('settings:cli.test.success') } } }));
                      } else {
                        setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: false, message: output.stderr.trim() || t('settings:cli.test.exitCode', { code: output.code }) } } }));
                      }
                    } catch (err) {
                      setTestStatus((s) => ({ ...s, [a.id]: { testing: false, result: { success: false, message: t('settings:cli.test.cannotRun', { error: String(err) }) } } }));
                    }
                    setTimeout(() => setTestStatus((s) => ({ ...s, [a.id]: { ...s[a.id], result: undefined } })), 6000);
                  }}
                >{st.testing ? t('settings:cli.test.testing') : t('settings:cli.test.label')}</button>
              </div>
              {st.result && (
                <span style={{ fontSize: 11, color: st.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }} className="mt-1 inline-block">
                  {st.result.message}
                </span>
              )}
              <div className="text-[10.5px] text-t3 mt-1">{t('settings:cli.cliPath.hint')}</div>
            </div>
          );
        })}
      </div>
      <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5 mt-4">
        <Lightbulb size={17} className="shrink-0 mt-px text-acc" />
        <div>
          <h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">{t('settings:cli.usage.title')}</h4>
          <p className="text-[11px] text-t3 leading-normal m-0">{t('settings:cli.usage.description')}</p>
        </div>
      </div>
    </div>
  );
}
