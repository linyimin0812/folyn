/**
 * CLI 工具 settings tab — adapter selection + CLI path detection/test.
 *
 * Extracted from SettingsPage.tsx to split the old single "AI 工具" tab into
 * two sibling components (this one + ModelServicesSettings). All state is
 * read from aiConfigStore; this component owns only the local test-result
 * UI state.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { listAdapters, buildAdapterVersionCommand } from '@quill/cli-adapter';

type TestStatus = { testing: boolean; result?: { success: boolean; message: string } };

export function CliSettings() {
  const { t } = useTranslation();
  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const cliPaths = useAiConfigStore((s) => s.cliPaths);
  const setCliAdapter = useAiConfigStore((s) => s.setCliAdapter);
  const setCliPathFor = useAiConfigStore((s) => s.setCliPathFor);
  // Per-adapter test result state, keyed by adapter id.
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});

  return (
    <div className="mb-8 whitespace-nowrap">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:cli.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:cli.description')}</div>
      </div>
      <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-2 flex items-center gap-1.5">{t('settings:cli.cliAdapter')}</div>
      <div className="ml flex flex-col gap-1">
        {listAdapters().map((a) => (
          <div
            key={a.id}
            className={`mi flex items-center justify-between py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${cliAdapter === a.id ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
            onClick={() => setCliAdapter(a.id)}
          >
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full border-2 shrink-0 ${cliAdapter === a.id ? 'bg-acc border-acc' : 'border-brd2'}`} />
              <div>
                <div className="text-xs font-semibold text-t1 font-mono">{a.displayName}</div>
                <div className="text-[10px] text-t3 mt-px">{a.description}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mb-3.5 mt-4">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">{t('settings:cli.cliPath.label')}</div>
        <div className="text-[10.5px] text-t3 mb-2.5">每个 Adapter 独立存储可执行文件路径，切换 Adapter 时各自使用自己的路径。</div>
        <div className="flex flex-col gap-2">
          {listAdapters().map((a) => {
            const path = cliPaths[a.id] ?? a.id;
            const st = testStatus[a.id] ?? { testing: false };
            return (
              <div key={a.id} className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold text-t2 font-mono flex items-center gap-1.5">
                  {a.displayName}
                  {cliAdapter === a.id && <span className="text-[9px] text-acc">● 使用中</span>}
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
                  <span style={{ fontSize: 11, color: st.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                    {st.result.message}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-[10.5px] text-t3 mt-1">{t('settings:cli.cliPath.hint')}</div>
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
