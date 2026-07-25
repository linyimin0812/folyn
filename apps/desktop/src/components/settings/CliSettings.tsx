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
import { listAdapters } from '@quill/cli-adapter';

export function CliSettings() {
  const { t } = useTranslation();
  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const cliPath = useAiConfigStore((s) => s.cliPath);
  const setCliAdapter = useAiConfigStore((s) => s.setCliAdapter);
  const setCliPath = useAiConfigStore((s) => s.setCliPath);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });

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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc" style={{ flex: 1 }} value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder="claude" autoCapitalize="off" />
          <button
            className="btn btn-g btn-sm"
            title={t('settings:cli.cliPath.detectTitle')}
            onClick={async () => {
              try {
                const { Command } = await import('@tauri-apps/plugin-shell');
                const adapterCmd = cliAdapter === 'claude' ? 'claude' : cliAdapter;
                const cmd = Command.create('claude-cli', ['-l', '-c', `which ${adapterCmd}`]);
                const output = await cmd.execute();
                const detected = output.stdout.trim().split('\n')[0];
                if (output.code === 0 && detected) {
                  setCliPath(detected);
                }
              } catch {}
            }}
          >{t('settings:cli.cliPath.detect')}</button>
        </div>
        <div className="text-[10.5px] text-t3 mt-1">{t('settings:cli.cliPath.hint')}</div>
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
        <button
          className="btn btn-g btn-sm"
          disabled={testStatus.testing}
          onClick={async () => {
            setTestStatus({ testing: true });
            try {
              const { Command } = await import('@tauri-apps/plugin-shell');
              const cliPath = useAiConfigStore.getState().cliPath || 'claude';
              const cmd = Command.create('claude-cli', ['-l', '-c', `${cliPath} --version`]);
              const output = await cmd.execute();
              if (output.code === 0) {
                const version = output.stdout.trim().split('\n')[0];
                setTestStatus({ testing: false, result: { success: true, message: version || t('settings:cli.test.success') } });
              } else {
                setTestStatus({ testing: false, result: { success: false, message: output.stderr.trim() || t('settings:cli.test.exitCode', { code: output.code }) } });
              }
            } catch (err) {
              setTestStatus({ testing: false, result: { success: false, message: t('settings:cli.test.cannotRun', { error: String(err) }) } });
            }
            setTimeout(() => setTestStatus((s) => ({ ...s, result: undefined })), 6000);
          }}
        >{testStatus.testing ? t('settings:cli.test.testing') : t('settings:cli.test.label')}</button>
        {testStatus.result && (
          <span style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
            {testStatus.result.message}
          </span>
        )}
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
